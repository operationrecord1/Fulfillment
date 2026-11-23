create function fulfillment_private.due_refund_candidates_for(target uuid,target_order text)
returns table(store_id uuid,order_id text,recipient_id uuid,email text,event_key text,payload jsonb)
language sql stable security definer set search_path='' as $$
 with base as (
 select o.store_id,o.external_id,o.data,
 case when e.data ? 'status' then e.data->>'status' else w.data->>'status' end manual,
 dt.data delivery,rr.external_id return_id,rr.data return_data,rr.updated_at return_seen,
 s.name store_name,p.user_id,p.email
 from fulfillment_private.ebay_records o
 join public.stores s on s.id=o.store_id
 -- The store's original active employee account owns its reminders. Never investor/admin.
 join lateral (select p.user_id,p.email from public.profiles p where p.store_id=o.store_id
 and p.role='staff' and p.is_active order by p.created_at,p.user_id limit 1) p on true
 left join fulfillment_private.ebay_order_edits e on e.store_id=o.store_id and e.order_id=o.external_id
 left join lateral(select w.data from fulfillment_private.order_rows w where w.store_id=o.store_id
 and btrim(w.data->>'order_id')=o.external_id and nullif(w.data->>'status','') is not null
 order by w.year,w.month,w.position limit 1) w on true
 left join fulfillment_private.ebay_records dt on dt.store_id=o.store_id and dt.resource='delivery_tracking' and dt.external_id=o.external_id
 left join lateral(select r.external_id,r.data,r.updated_at from fulfillment_private.ebay_records r
 where r.store_id=o.store_id and r.resource='returns' and r.data->>'orderId'=o.external_id
 and coalesce(r.data->>'state','')<>'CLOSED' and r.data#>>'{_returnTracking,active}'='true'
 and (r.data#>>'{_returnTracking,deliveryStatus}'='DELIVERED' or r.data#>>'{_returnTracking,markAsReceived}'='true')
 order by r.external_id limit 1) rr on true
 where o.resource='orders' and o.store_id=target and o.external_id=target_order
 ), eligible as (
 select *,case when return_id is not null then 'return-received:'||return_id else 'outbound-delivered' end event
 from base where coalesce(manual,'') not in ('Alert','OOS','Refunded')
 and coalesce(data->>'orderPaymentStatus','')<>'FULLY_REFUNDED'
 and coalesce(data#>>'{cancelStatus,cancelState}','')<>'CANCELED'
 and (return_id is not null or (manual='Due Refund' and delivery->>'source'='ebay_get_orders'
 and coalesce(delivery->>'deliveredAt','') ~ '^\d{4}-\d{2}-\d{2}T'))
 )
 select store_id,external_id,user_id,email,event,jsonb_build_object(
 'orderId',external_id,'store',store_name,'title',data#>>'{lineItems,0,title}',
 'image',data#>>'{_orderSnapshot,image}','reason',case when return_id is not null then 'return_received' else 'outbound_delivered' end,
 'eventDate',case when return_id is not null then return_seen::text else delivery->>'deliveredAt' end,
 'dateLabel',case when return_id is not null then 'Return Receipt Detected' else 'eBay Delivered Date' end)
 from eligible;
$$;

revoke all on function fulfillment_private.due_refund_candidates_for(uuid,text) from public,anon,authenticated;
create or replace function public.due_refund_mail_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare job fulfillment_private.due_refund_mail; candidate record; dirty record;
begin
 if action='claim' then
  -- An expired send is ambiguous: do not blindly resend beyond provider idempotency TTL.
  update fulfillment_private.due_refund_mail set state='uncertain',last_error='Send interrupted; provider verification required'
  where state='sending' and lease_until<now();
  for dirty in select * from fulfillment_private.refund_dirty order by changed_at limit 100 for update skip locked loop
   insert into fulfillment_private.due_refund_mail(store_id,order_id,recipient_id,event_key,payload)
   select store_id,order_id,recipient_id,event_key,c.payload from fulfillment_private.due_refund_candidates_for(dirty.store_id,dirty.order_id) c
   on conflict(store_id,order_id,recipient_id,event_key) do update set state='pending',next_attempt=now() where due_refund_mail.state='cancelled';
   delete from fulfillment_private.refund_dirty where store_id=dirty.store_id and order_id=dirty.order_id;
  end loop;
  select * into job from fulfillment_private.due_refund_mail q where state='pending' and next_attempt<=now()
  order by created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  select * into candidate from fulfillment_private.due_refund_candidates_for(job.store_id,job.order_id) c where c.store_id=job.store_id
   and c.order_id=job.order_id and c.recipient_id=job.recipient_id and c.event_key=job.event_key;
  if not found then
   update fulfillment_private.due_refund_mail set state='cancelled' where id=job.id;
   return jsonb_build_object('skipped',true);
  end if;
  update fulfillment_private.due_refund_mail set state='sending',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,
  payload=candidate.payload where id=job.id returning * into job;
  return jsonb_build_object('id',job.id,'lease',job.lease,'email',candidate.email,'payload',job.payload);
 elsif action in ('sent','uncertain','retry') then
  update fulfillment_private.due_refund_mail set
   state=case when action='retry' and attempts<5 then 'pending' when action='retry' then 'uncertain' else action end,
   next_attempt=now()+interval '5 minutes',sent_at=case when action='sent' then now() else null end,
   provider_id=left($2->>'providerId',300),last_error=left($2->>'error',300),lease_until=null
  where id=($2->>'id')::uuid and lease=($2->>'lease')::uuid and state='sending';
  if not found then raise exception 'Invalid mail lease'; end if;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Invalid mail action';
end $$;
