-- A per-order submission guard; never stores internal tracking or changes money.
create table fulfillment_private.ebay_tracking_actions (
 store_id uuid not null references public.stores(id),order_id text not null,
 state text not null check(state in ('checking','rejected','unknown','confirmed')),
 attempt_id uuid not null, tracking text,carrier text,shipments jsonb not null default '[]',
 message text,updated_at timestamptz not null default now(),updated_by uuid,
 primary key(store_id,order_id)
);
alter table fulfillment_private.ebay_tracking_actions enable row level security;
revoke all on fulfillment_private.ebay_tracking_actions from public,anon,authenticated;
create table fulfillment_private.ebay_message_drafts (
 store_id uuid not null references public.stores(id),order_id text not null,
 kind text not null check(kind in ('purchase','delivered','due_refund')),
 body text not null check(length(body)<=2000),revision integer not null default 1,
 updated_at timestamptz not null default now(),updated_by uuid,
 primary key(store_id,order_id,kind)
);
alter table fulfillment_private.ebay_message_drafts enable row level security;
revoke all on fulfillment_private.ebay_message_drafts from public,anon,authenticated;
create or replace function public.ebay_tracking_worker(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid:=(payload->>'store_id')::uuid; oid text:=payload->>'order_id';actor uuid:=(payload->>'actor')::uuid;
 a fulfillment_private.ebay_tracking_actions; attempt uuid; result jsonb;
begin
 if not exists(select 1 from public.profiles p where p.user_id=actor and p.is_active and (p.role='admin' or(p.role='staff' and p.store_id=target))) then raise exception 'Store access required';end if;
 if not exists(select 1 from fulfillment_private.ebay_records r where r.store_id=target and r.resource='orders' and r.external_id=oid) then raise exception 'Order not found';end if;
 if action='draft_save' then
  if payload->>'kind' not in ('purchase','delivered','due_refund') or jsonb_typeof(payload->'body')<>'string' or length(payload->>'body')>2000 then raise exception 'Invalid message draft';end if;
  insert into fulfillment_private.ebay_message_drafts as d(store_id,order_id,kind,body,updated_by)
  select target,oid,payload->>'kind',payload->>'body',actor where (payload->>'revision')::integer=0
  on conflict do nothing;
  if not found then
   update fulfillment_private.ebay_message_drafts d set body=payload->>'body',revision=d.revision+1,updated_at=now(),updated_by=actor
   where d.store_id=target and d.order_id=oid and d.kind=payload->>'kind' and d.revision=(payload->>'revision')::integer;
   if not found then raise exception 'Draft changed in another session. Reopen before saving.';end if;
  end if;
 elsif action='claim' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text||':'||oid,0));
  select * into a from fulfillment_private.ebay_tracking_actions where store_id=target and order_id=oid for update;
  if found and (a.state in ('unknown','confirmed') or (a.state='checking' and a.updated_at>now()-interval '2 minutes')) then return jsonb_build_object('claimed',false,'state',a.state);end if;
  attempt=gen_random_uuid();
  insert into fulfillment_private.ebay_tracking_actions as t(store_id,order_id,state,attempt_id,tracking,carrier,updated_by)
  values(target,oid,'checking',attempt,payload->>'tracking',payload->>'carrier',actor)
  on conflict(store_id,order_id) do update set state='checking',attempt_id=excluded.attempt_id,tracking=excluded.tracking,carrier=excluded.carrier,message=null,updated_at=now(),updated_by=actor;
  return jsonb_build_object('claimed',true,'attempt_id',attempt);
 elsif action='transition' then
  if payload->>'state' not in ('unknown','confirmed','rejected') then raise exception 'Invalid transition';end if;
  update fulfillment_private.ebay_tracking_actions set state=payload->>'state',message=left(payload->>'message',600),shipments=coalesce(payload->'shipments',shipments),updated_at=now()
  where store_id=target and order_id=oid and attempt_id=(payload->>'attempt_id')::uuid
   and (state='checking' or (state='unknown' and payload->>'state' in ('confirmed','rejected')));
  if not found then raise exception 'Submission state changed; reload the order';end if;
 elsif action='observed' then
  if jsonb_array_length(payload->'shipments')>0 then
   update fulfillment_private.ebay_tracking_actions set state='confirmed',shipments=payload->'shipments',updated_at=now(),message='Shipment confirmed on eBay'
   where store_id=target and order_id=oid and state='unknown';
  end if;
 elsif action<>'read' then raise exception 'Invalid action';end if;
 select jsonb_build_object('submission',(select to_jsonb(t)-'updated_by'-'attempt_id' from fulfillment_private.ebay_tracking_actions t where t.store_id=target and t.order_id=oid),
 'drafts',coalesce((select jsonb_object_agg(d.kind,jsonb_build_object('body',d.body,'revision',d.revision,'updated_at',d.updated_at)) from fulfillment_private.ebay_message_drafts d where d.store_id=target and d.order_id=oid),'{}'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.ebay_tracking_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_tracking_worker(text,jsonb) to service_role;
