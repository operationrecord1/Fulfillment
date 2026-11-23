-- Read only verified same-store return tracking; preserve edit revision/manual status.
do $$ declare definition text; begin
 select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='ebay_orders_period_page';
 if position('''returns'',(select' in definition)=0 then
 definition=replace(definition,'''data'',p.data,''edit'',','''data'',p.data,''returns'',(select coalesce(jsonb_agg(jsonb_build_object(''state'',rr.data->>''state'',''tracking'',rr.data->''_returnTracking'')),''[]''::jsonb) from fulfillment_private.ebay_records rr where rr.store_id=target and rr.resource=''returns'' and rr.data->>''orderId''=p.external_id),''edit'',');
 execute definition;
 end if;
end $$;
