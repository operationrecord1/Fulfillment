-- Authenticated, store-scoped idempotent commits. Existing validators remain authoritative.
create table if not exists fulfillment_private.workspace_receipts(
 store_id uuid not null references public.stores(id),request_id uuid not null,actor uuid not null,
 payload_hash text not null,response jsonb not null,created_at timestamptz not null default now(),
 primary key(store_id,request_id)
);
alter table fulfillment_private.workspace_receipts enable row level security;
revoke all on fulfillment_private.workspace_receipts from public,anon,authenticated;
create or replace function public.workspace_commit(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; receipt fulfillment_private.workspace_receipts; result jsonb; req uuid; yr integer; mon integer;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active and role::text='staff';
 if p.store_id is null then raise exception 'Active employee access required' using errcode='42501';end if;
 req:=(payload->>'request_id')::uuid;yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;
 if req is null then raise exception 'Missing request identity';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.store_id::text||req::text,0));
 select * into receipt from fulfillment_private.workspace_receipts where store_id=p.store_id and request_id=req;
 if found then
  if receipt.actor<>p.user_id or receipt.payload_hash<>md5(payload::text) then raise exception 'Request identity cannot be reused';end if;
  return receipt.response;
 end if;
 result:=public.order_workspace('grid_commit',payload-'request_id');
 -- Existing row IDs are already stable; retain only new-ID mappings in receipts.
 result:=jsonb_set(result,'{mappings}',coalesce((select jsonb_agg(m) from jsonb_array_elements(result->'mappings') m where exists(select 1 from jsonb_array_elements(payload->'rows') r where nullif(r->>'id','') is null and r->>'key'=m->>'key')),'[]'::jsonb));
 insert into fulfillment_private.workspace_receipts(store_id,request_id,actor,payload_hash,response) values(p.store_id,req,p.user_id,md5(payload::text),result);
 return result;
end $$;
revoke all on function public.workspace_commit(jsonb) from public,anon;
grant execute on function public.workspace_commit(jsonb) to authenticated;

create or replace function public.workspace_channel_allowed(topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.is_active and p.role::text in ('staff','investor') and topic='workspace:'||p.store_id::text)
$$;
revoke all on function public.workspace_channel_allowed(text) from public,anon;
grant execute on function public.workspace_channel_allowed(text) to authenticated;
create policy workspace_receive on realtime.messages for select to authenticated
 using(public.workspace_channel_allowed(realtime.topic()));
create policy workspace_send on realtime.messages for insert to authenticated
 with check(public.workspace_channel_allowed(realtime.topic()) and extension in ('broadcast','presence'));
