create or replace function public.due_refund_mail_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare job fulfillment_private.due_refund_mail; candidate record;
begin
 if action='claim' then
  -- An expired send is ambiguous: do not blindly resend beyond provider idempotency TTL.
  update fulfillment_private.due_refund_mail set state='uncertain',last_error='Send interrupted; provider verification required'
  where state='sending' and lease_until<now();
  insert into fulfillment_private.due_refund_mail(store_id,order_id,recipient_id,event_key,payload)
  select store_id,order_id,recipient_id,event_key,c.payload from fulfillment_private.due_refund_candidates() c
  on conflict(store_id,order_id,recipient_id,event_key) do update set state='pending',next_attempt=now() where due_refund_mail.state='cancelled';
  select * into job from fulfillment_private.due_refund_mail q where state='pending' and next_attempt<=now()
  order by created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  select * into candidate from fulfillment_private.due_refund_candidates() c where c.store_id=job.store_id
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
