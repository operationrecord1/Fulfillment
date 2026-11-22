-- Private, durable inbox. Only the signature-verifying Edge Function can write it.
create table fulfillment_private.ebay_notification_config (
 singleton boolean primary key default true check(singleton),
 verification_secret_id uuid not null, destination_id text, setup_result jsonb,
 updated_at timestamptz not null default now()
);
insert into fulfillment_private.ebay_notification_config(verification_secret_id)
select vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'ebay_notification_verification');
create table fulfillment_private.ebay_notification_subscriptions (
 store_id uuid not null references fulfillment_private.ebay_connections(store_id),
 topic text not null, subscription_id text not null, status text not null,
 updated_at timestamptz not null default now(), primary key(store_id,topic)
);
create table fulfillment_private.ebay_notification_inbox (
 notification_id text primary key, store_id uuid references fulfillment_private.ebay_connections(store_id),
 topic text not null, resource text not null, entity_id text, event_at timestamptz not null,
 received_at timestamptz not null default now(), processed_at timestamptz,
 payload jsonb not null, disposition text not null default 'pending'
);
create index ebay_inbox_pending on fulfillment_private.ebay_notification_inbox(store_id,resource,received_at) where processed_at is null;
alter table fulfillment_private.ebay_notification_config enable row level security;
alter table fulfillment_private.ebay_notification_subscriptions enable row level security;
alter table fulfillment_private.ebay_notification_inbox enable row level security;
revoke all on fulfillment_private.ebay_notification_config,fulfillment_private.ebay_notification_subscriptions,fulfillment_private.ebay_notification_inbox from public,anon,authenticated;
create function public.ebay_notification_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; target uuid; topic_name text; res text; uid text; uname text;
begin
 if auth.role()<>'service_role' and session_user<>'postgres' then raise exception 'Service access required'; end if;
 if action='config' then
  select jsonb_build_object('verificationToken',v.decrypted_secret,'destinationId',c.destination_id) into result from fulfillment_private.ebay_notification_config c join vault.decrypted_secrets v on v.id=c.verification_secret_id;
 elsif action='stores' then
  select coalesce(jsonb_agg(jsonb_build_object('store_id',c.store_id,'seller_id',c.seller_id,'username',c.username,'access_expires_at',c.access_expires_at,'tokens',v.decrypted_secret::jsonb)),'[]') into result from fulfillment_private.ebay_connections c join vault.decrypted_secrets v on v.id=c.token_secret_id;
 elsif action='traffic_sample' then
  select coalesce(jsonb_agg(jsonb_build_object('id',external_id,'data',data)),'[]') into result from (select external_id,data from fulfillment_private.ebay_records where store_id=(payload->>'store_id')::uuid and resource='listing_traffic' order by external_id limit 3) x;
 elsif action='destination' then
  update fulfillment_private.ebay_notification_config set destination_id=payload->>'id',updated_at=now() where singleton;
 elsif action='subscription' then
  insert into fulfillment_private.ebay_notification_subscriptions(store_id,topic,subscription_id,status) values((payload->>'store_id')::uuid,payload->>'topic',payload->>'id',payload->>'status') on conflict(store_id,topic) do update set subscription_id=excluded.subscription_id,status=excluded.status,updated_at=now();
 elsif action='result' then
  update fulfillment_private.ebay_notification_config set setup_result=payload,updated_at=now() where singleton;
 elsif action='enqueue' then
  topic_name=payload#>>'{metadata,topic}';
  res=case when topic_name='LISTING' then 'listings' when topic_name in ('ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY') then 'orders' else null end;
  if res is null then return '{"ignored":true}'; end if;
  uid=coalesce(payload#>>'{notification,data,user,userId}',payload#>>'{notification,data,orderCancellation,seller,userId}'); uname=coalesce(payload#>>'{notification,data,user,username}',payload#>>'{notification,data,orderCancellation,seller,username}');
  select store_id into target from fulfillment_private.ebay_connections where seller_id=uid;
  if target is null and uname is not null then select store_id into target from fulfillment_private.ebay_connections where lower(username)=lower(uname); end if;
  insert into fulfillment_private.ebay_notification_inbox(notification_id,store_id,topic,resource,entity_id,event_at,payload,disposition)
  values(payload#>>'{notification,notificationId}',target,topic_name,res,coalesce(payload#>>'{notification,data,listingId}',payload#>>'{notification,data,order,orderId}',payload#>>'{notification,data,orderId}',payload#>>'{notification,data,orderCancellation,cancellationLineItems,0,orderId}'),(payload#>>'{notification,eventDate}')::timestamptz,payload,case when target is null then 'unmatched' else 'pending' end)
  on conflict(notification_id) do nothing;
  return jsonb_build_object('accepted',true,'matched',target is not null);
 else raise exception 'Unknown notification operation'; end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.ebay_notification_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_notification_worker(text,jsonb) to service_role;
