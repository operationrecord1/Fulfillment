begin;
do $test$
declare s uuid; oid text:='status-rule-test-'||gen_random_uuid(); rid text:='return-rule-test-'||gen_random_uuid(); n integer; status text;
begin
 select store_id into s from public.profiles where role='staff' and is_active and store_id is not null limit 1;
 if s is null then raise exception 'No active employee fixture'; end if;
 insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values
 (s,'orders',oid,jsonb_build_object('creationDate',now(),'orderPaymentStatus','PAID','lineItems',jsonb_build_array(jsonb_build_object('title','Rollback status test')))),
 (s,'delivery_tracking',oid,'{"source":"ebay_get_orders","deliveredAt":"2026-11-23T12:00:00Z"}');
 insert into fulfillment_private.ebay_order_edits(store_id,order_id,data) values(s,oid,'{"status":"Due Refund"}');
 select count(*) into n from fulfillment_private.due_refund_candidates_for(s,oid) where event_key='outbound-delivered';
 if n<>1 then raise exception 'Manual Due Refund delivered reminder missing: %',n; end if;
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid) c join public.profiles p on p.user_id=c.recipient_id where p.role<>'staff' or not p.is_active or p.store_id<>s) then raise exception 'Wrong recipient'; end if;
 for i in 1..2 loop
 insert into fulfillment_private.due_refund_mail(store_id,order_id,recipient_id,event_key,payload)
 select store_id,order_id,recipient_id,event_key,payload from fulfillment_private.due_refund_candidates_for(s,oid)
 on conflict(store_id,order_id,recipient_id,event_key) do nothing;
 end loop;
 if (select count(*) from fulfillment_private.due_refund_mail where store_id=s and order_id=oid)<>1 then raise exception 'Duplicate reminder'; end if;
 foreach status in array array['Alert','OOS'] loop
 update fulfillment_private.ebay_order_edits set data=jsonb_build_object('status',status) where store_id=s and order_id=oid;
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Locked order reminder'; end if;
 end loop;
 update fulfillment_private.ebay_order_edits set data='{"status":"Due Refund"}' where store_id=s and order_id=oid;
 update fulfillment_private.ebay_records set data=data||'{"cancelStatus":{"cancelState":"CANCELED"}}' where store_id=s and resource='orders' and external_id=oid;
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Cancelled reminder'; end if;
 update fulfillment_private.ebay_records set data=(data-'cancelStatus')||'{"orderPaymentStatus":"FULLY_REFUNDED"}' where store_id=s and resource='orders' and external_id=oid;
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Refunded reminder'; end if;
 update fulfillment_private.ebay_records set data=data||'{"orderPaymentStatus":"PARTIALLY_REFUNDED"}' where store_id=s and resource='orders' and external_id=oid;
 if not exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Partial refund suppressed pending work'; end if;
 update fulfillment_private.ebay_order_edits set data='{"status":"Pending"}' where store_id=s and order_id=oid;
 insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values(s,'returns',rid,jsonb_build_object('orderId',oid,'state','ITEM_SHIPPED','_returnTracking',jsonb_build_object('active',true,'labelDate',jsonb_build_object('value','2026-11-22T00:00:00Z'),'deliveryStatus','IN_TRANSIT')));
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Label alone sent reminder'; end if;
 update fulfillment_private.ebay_records set data=jsonb_set(data,'{_returnTracking,deliveryStatus}','"DELIVERED"') where store_id=s and resource='returns' and external_id=rid;
 if not exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid) where event_key='return-received:'||rid) then raise exception 'Return received reminder missing'; end if;
 update fulfillment_private.ebay_records set data=data||'{"state":"CLOSED"}' where store_id=s and resource='returns' and external_id=rid;
 if exists(select 1 from fulfillment_private.due_refund_candidates_for(s,oid)) then raise exception 'Closed return reminder'; end if;
 if has_function_privilege('anon','public.due_refund_mail_worker(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.due_refund_mail_worker(text,jsonb)','EXECUTE') then raise exception 'Exposed mail worker'; end if;
end $test$;
rollback;
select 'PASS: manual delivery, employee recipient, deduplication, locks, cancellation/full-refund suppression, partial refund, label-only suppression, return received, closed return, private worker. All test data rolled back; no email sent.' result;