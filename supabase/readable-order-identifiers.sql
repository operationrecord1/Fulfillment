alter table fulfillment_private.order_rows
 add column display_number bigint generated always as identity (maxvalue 99999999 no cycle);
alter table fulfillment_private.order_rows add constraint order_rows_display_number_key unique(display_number);
do $migration$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
 updated:=replace(definition, 'jsonb_build_object(''id'',id,''month'',month', 'jsonb_build_object(''id'',id,''display_number'',display_number::text,''month'',month');
 if updated=definition then raise exception 'Read response anchor changed'; end if;
 execute updated;
 definition:=pg_get_functiondef('fulfillment_private.spreadsheet_workspace(text,jsonb)'::regprocedure);
 updated:=replace(definition, '''revision'',saved->''revision''', '''revision'',saved->''revision'',''display_number'',saved->>''display_number''');
 if updated=definition then raise exception 'Commit response anchor changed'; end if;
 execute updated;
end $migration$;
