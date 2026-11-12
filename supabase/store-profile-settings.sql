alter table fulfillment_private.store_options add column if not exists statuses text[] not null default array['Pending','Processed','Delivered','Label Created','Cancelled','Refunded','OOS','Alert'], add column if not exists logo text not null default '';
do $patch$
declare original text; updated text;
begin
original:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
updated:=replace(original,'''tax_percentage'',tax_percentage)', '''tax_percentage'',tax_percentage,''statuses'',statuses,''logo'',logo)');
updated:=replace(updated,'''revision'',revision) from fulfillment_private.store_options', '''revision'',revision,''statuses'',statuses,''logo'',logo) from fulfillment_private.store_options');
updated:=replace(updated,'   insert into fulfillment_private.store_options(store_id,platforms,tax_percentage)',$body$
   if payload ? 'statuses' then
     if jsonb_typeof(payload->'statuses')<>'array' or jsonb_array_length(payload->'statuses')>50 then raise exception 'Maximum 50 order statuses'; end if;
     if exists(select 1 from jsonb_array_elements(payload->'statuses') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 60) then raise exception 'Invalid status name'; end if;
   end if;
   if payload ? 'logo' and (jsonb_typeof(payload->'logo')<>'string' or length(payload->>'logo')>100000 or ((payload->>'logo')<>'' and (payload->>'logo') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')) then raise exception 'Invalid store logo'; end if;
   insert into fulfillment_private.store_options(store_id,platforms,tax_percentage)
$body$);
updated:=replace(updated,'   return (select jsonb_build_object(''platforms'',platforms,''tax_percentage'',tax_percentage',$body$
   update fulfillment_private.store_options set
     statuses=case when payload ? 'statuses' then array(select distinct btrim(value) from jsonb_array_elements_text(payload->'statuses')) else statuses end,
     logo=case when payload ? 'logo' then payload->>'logo' else logo end
     where store_id=p.store_id;
   return (select jsonb_build_object('platforms',platforms,'tax_percentage',tax_percentage$body$);
if updated=original then raise exception 'Settings anchors missing';end if;
execute updated;
end $patch$;
