do $patch$
declare original text; updated text;
begin
original:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
updated:=replace(original,' elsif action in (''platforms'',''workspace_settings'') then',$body$
 elsif action='rename_store' then
   if p.role::text<>'staff' then raise exception 'Only store staff can change the store name' using errcode='42501'; end if;
   if jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 2 and 120 then raise exception 'Store name must contain 2 to 120 characters'; end if;
   begin
     update public.stores set name=btrim(payload->>'name')
       where id=p.store_id and name=payload->>'previous_name';
   exception when unique_violation then raise exception 'This store name is already in use'; end;
   if not found then raise exception 'Store name changed. Reload before saving'; end if;
   return jsonb_build_object('name',btrim(payload->>'name'));
 elsif action in ('platforms','workspace_settings') then
$body$);
if updated=original then raise exception 'Settings anchor missing';end if;
execute updated;
end $patch$;
