-- All fixture mutations and queue writes roll back. No provider calls occur.
begin;
do $$
declare s uuid; oid text; rid text; j jsonb; n integer;
begin
 select store_id,external_id into s,oid from fulfillment_private.ebay_records
 where resource='orders' and external_id='26-15401-29635';
 if s is null then raise exception 'Fixture order missing'; end if;
 insert into fulfillment_private.ebay_order_edits(store_id,order_id,data) values(s,oid,'{"status":"Due Refund"}')
 on conflict(store_id,order_id) do update set data=excluded.data;
 update fulfillment_private.ebay_records set data=jsonb_set(data,'{deliveredAt}','"2026-11-23T12:00:00Z"')
 where store_id=s and external_id=oid and resource='delivery_tracking';
 select count(*) into n from fulfillment_private.due_refund_candidates() where store_id=s and order_id=oid;
 if n<>1 then raise exception 'Manual due refund delivered expected one employee reminder, got %',n; end if;
 if exists(select 1 from fulfillment_private.due_refund_candidates() c join public.profiles p on p.user_id=c.recipient_id where p.role<>'staff' or not p.is_active or p.store_id<>c.store_id) then raise exception 'Recipient isolation failed'; end if;
 j=public.due_refund_mail_worker('claim');
 if j->>'id' is null then raise exception 'Claim failed'; end if;
 perform public.due_refund_mail_worker('sent',jsonb_build_object('id',j->>'id','lease',j->>'lease','providerId','TEST-ROLLBACK'));
 perform public.due_refund_mail_worker('claim');
 select count(*) into n from fulfillment_private.due_refund_mail where store_id=s and order_id=oid;
 if n<>1 then raise exception 'Duplicate email queued'; end if;
 update fulfillment_private.ebay_records set data=jsonb_set(data,'{orderPaymentStatus}','"FULLY_REFUNDED"') where store_id=s and external_id=oid and resource='orders';
 if exists(select 1 from fulfillment_private.due_refund_candidates() where store_id=s and order_id=oid) then raise exception 'Completed refund reminder not suppressed'; end if;
 select external_id into rid from fulfillment_private.ebay_records where store_id=s and resource='returns' and data->>'orderId'='07-15434-48091';
 update fulfillment_private.ebay_order_edits set data=data-'status' where store_id=s and order_id='07-15434-48091';
 update fulfillment_private.ebay_records set data=jsonb_set(data,'{_returnTracking,deliveryStatus}','"DELIVERED"') where store_id=s and resource='returns' and external_id=rid;
 if not exists(select 1 from fulfillment_private.due_refund_candidates() where store_id=s and order_id='07-15434-48091' and event_key='return-received:'||rid) then raise exception 'Return receipt event missing'; end if;
 if has_function_privilege('anon','public.due_refund_mail_worker(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.due_refund_mail_worker(text,jsonb)','EXECUTE') then raise exception 'Worker publicly callable'; end if;
end $$;
rollback;
select 'Passed: delivery, return receipt, employee isolation, deduplication, refund suppression, worker access; all fixture writes rolled back' result;
