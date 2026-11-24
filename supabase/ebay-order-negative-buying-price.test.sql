-- Read-only regression for the deployed editor validation; no orders are inserted or updated.
begin read only;
do $test$
declare definition text; validation text; fixture record; accepted boolean;
begin
 definition=pg_get_functiondef('public.ebay_order_edit_save(uuid,text,jsonb,integer)'::regprocedure);
 validation=' for k,v in select * from jsonb_each(changes) loop'
  ||split_part(split_part(definition,' for k,v in select * from jsonb_each(changes) loop',2),' end loop;',1)||' end loop;';
 if position('Invalid buying price' in validation)=0 then raise exception 'Editor validation block was not found'; end if;
 for fixture in select * from (values
  ('{"buy_price":null}'::jsonb,true),
  ('{"buy_price":-5}'::jsonb,true),
  ('{"buy_price":-0.01}'::jsonb,true),
  ('{"buy_price":0}'::jsonb,true),
  ('{"buy_price":5}'::jsonb,true),
  ('{"buy_price":-999999999}'::jsonb,true),
  ('{"buy_price":999999999}'::jsonb,true),
  ('{"buy_price":-1000000000}'::jsonb,false),
  ('{"buy_price":1000000000}'::jsonb,false),
  ('{"buy_price":0.001}'::jsonb,false),
  ('{"buy_price":-0.001}'::jsonb,false),
  ('{"buy_price":""}'::jsonb,false),
  ('{"buy_price":"5"}'::jsonb,false),
  ('{"buy_price":true}'::jsonb,false),
  ('{"buy_price":{}}'::jsonb,false),
  ('{"buy_price":[5]}'::jsonb,false),
  ('{"shipping_cost":-5}'::jsonb,false),
  ('{"shipping_cost":0}'::jsonb,true),
  ('{"shipping_cost":5}'::jsonb,true),
  ('{"shipping_cost":null}'::jsonb,true),
  ('{"shipping_cost":0.001}'::jsonb,false),
  ('{"additional_cost":-5}'::jsonb,false),
  ('{"additional_cost":0}'::jsonb,true),
  ('{"additional_cost":5}'::jsonb,true),
  ('{"additional_cost":null}'::jsonb,true),
  ('{"additional_cost":0.001}'::jsonb,false),
  ('{"buy_price":-5,"shipping_cost":2,"additional_cost":1}'::jsonb,true),
  ('{"buy_price":-5,"shipping_cost":-2}'::jsonb,false)
 ) tests(changes,expected) loop
  accepted=true;
  begin
   execute 'do $validation$ declare changes jsonb := '||quote_literal(fixture.changes::text)||'::jsonb; k text; v jsonb; begin '||validation||' end $validation$;';
  exception when others then accepted=false;
  end;
  if accepted is distinct from fixture.expected then raise exception 'Price validation mismatch: %, accepted %, expected %',fixture.changes,accepted,fixture.expected; end if;
 end loop;
end $test$;
select '28 editor price validation cases passed' as result;
rollback;

