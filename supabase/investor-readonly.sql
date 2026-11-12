do $patch$
declare src text;
begin
src:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
if position('''additional_cost'',data->''additional_cost'',''date'',data->''date'') end' in src)=0 then raise exception 'Investor projection not found';end if;
src:=replace(src,'''additional_cost'',data->''additional_cost'',''date'',data->''date'') end','''additional_cost'',data->''additional_cost'',''date'',data->''date'',''platform'',data->''platform'',''tracking'',data->''tracking'',''secondary_tracking'',data->''secondary_tracking'') end');
src:=replace(src,'into opts from fulfillment_private.store_options where store_id=p.store_id;','into opts from fulfillment_private.store_options where store_id=p.store_id; if p.role::text=''investor'' then opts:=opts-''monthly_targets''; end if;');
execute src;
src:=pg_get_functiondef('fulfillment_private.spreadsheet_workspace(text,jsonb)'::regprocedure);
src:=replace(src,'elsif action=''grid_preferences'' then','elsif action=''grid_preferences'' then if p.role::text<>''staff'' then raise exception ''View-only access'' using errcode=''42501''; end if;');
execute src;
end $patch$;