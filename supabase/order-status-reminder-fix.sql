-- Status-only reminder correction. Financial functions are intentionally untouched.
do $fix$
declare signature text; definition text;
begin
 foreach signature in array array['fulfillment_private.due_refund_candidates_for(uuid,text)','fulfillment_private.due_refund_candidates()','fulfillment_private.schedule_delivery(uuid,text,boolean)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'''Alert'',''OOS'',''Refunded''','''Alert'',''OOS''');
  definition:=replace(definition,chr(92)||chr(92)||'d{4}-'||chr(92)||chr(92)||'d{2}-'||chr(92)||chr(92)||'d{2}T','[0-9]{4}-[0-9]{2}-[0-9]{2}T');
  definition:=replace(definition,chr(92)||'d{4}-'||chr(92)||'d{2}-'||chr(92)||'d{2}T','[0-9]{4}-[0-9]{2}-[0-9]{2}T');
  execute definition;
 end loop;
end $fix$;
-- Reconsider only manually marked records affected by these rules; preserve sent-event deduplication.
insert into fulfillment_private.refund_dirty(store_id,order_id)
select store_id,order_id from fulfillment_private.ebay_order_edits where data->>'status' in ('Due Refund','Refunded')
on conflict(store_id,order_id) do update set changed_at=now();

select fulfillment_private.schedule_delivery(store_id,order_id,false) from fulfillment_private.ebay_order_edits where data->>'status'='Refunded';
