alter table fulfillment_private.store_options add column if not exists monthly_targets jsonb not null default '{}'::jsonb;
do $patch$
declare original text; updated text;
begin
original:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
updated:=replace(original,'''logo'',logo)', '''logo'',logo,''monthly_targets'',monthly_targets)');
updated:=replace(updated,' elsif action=''rename_store'' then',$body$
 elsif action='monthly_target' then
   yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;n:=(payload->>'amount')::numeric;
   if yr is null or yr not between 2000 and 2100 or mon is null or mon not between 1 and 12 or n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000000 then raise exception 'Invalid monthly target';end if;
   insert into fulfillment_private.store_options(store_id,revision) values(p.store_id,0) on conflict(store_id) do nothing;
   update fulfillment_private.store_options set monthly_targets=jsonb_set(monthly_targets,array[yr::text||'-'||lpad(mon::text,2,'0')],to_jsonb(round(n,2))),revision=revision+1
    where store_id=p.store_id and revision=(payload->>'revision')::integer returning revision into n;
   if not found then raise exception 'Settings changed. Reload before saving target';end if;
   return (select jsonb_build_object('monthly_targets',monthly_targets,'revision',revision) from fulfillment_private.store_options where store_id=p.store_id);
 elsif action='rename_store' then
$body$);
if updated=original then raise exception 'Monthly target anchors missing';end if;
execute updated;
end $patch$;

