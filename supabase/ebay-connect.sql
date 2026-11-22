-- Server-only OAuth storage. No browser roles can read state or tokens.
create table fulfillment_private.ebay_oauth_states (
 state_hash text primary key check(length(state_hash)=64),
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 scopes jsonb not null,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
create table fulfillment_private.ebay_connections (
 store_id uuid primary key references public.stores(id),
 seller_id text not null unique,
 username text not null,
 token_secret_id uuid not null,
 connected_by uuid not null,
 scopes jsonb not null,
 access_expires_at timestamptz not null,
 refresh_expires_at timestamptz not null,
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table fulfillment_private.ebay_oauth_states enable row level security;
alter table fulfillment_private.ebay_connections enable row level security;
revoke all on fulfillment_private.ebay_oauth_states,fulfillment_private.ebay_connections from public,anon,authenticated;

create function public.ebay_connection_worker(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; s fulfillment_private.ebay_oauth_states; c fulfillment_private.ebay_connections; secret_id uuid; target uuid; result jsonb;
begin
 if action='credentials' then
  return coalesce((select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets where name in ('ebay_client_id','ebay_client_secret','ebay_runame')),'{}'::jsonb);
 elsif action='begin' then
  select * into p from public.profiles where user_id=(payload->>'user_id')::uuid and is_active and role in ('staff','admin');
  if not found then raise exception 'Active employee required'; end if;
  target=case when p.role='admin' then coalesce((payload->>'store_id')::uuid,p.store_id) else p.store_id end;
  if target is null or (p.role<>'admin' and target is distinct from p.store_id) or not exists(select 1 from public.stores where id=target) then raise exception 'Store access required'; end if;
  delete from fulfillment_private.ebay_oauth_states where expires_at<now() or user_id=p.user_id;
  insert into fulfillment_private.ebay_oauth_states(state_hash,user_id,store_id,scopes) values(payload->>'hash',p.user_id,target,payload->'scopes');
  return '{}'::jsonb;
 elsif action='consume' then
  delete from fulfillment_private.ebay_oauth_states where state_hash=payload->>'hash' and expires_at>now() returning * into s;
  if not found then return null; end if;
  if not exists(select 1 from public.profiles where user_id=s.user_id and is_active and (role='admin' or (role='staff' and store_id=s.store_id))) then return null; end if;
  return jsonb_build_object('user_id',s.user_id,'store_id',s.store_id,'scopes',s.scopes);
 elsif action='save' then
  target=(payload->>'store_id')::uuid;
  if not exists(select 1 from public.profiles where user_id=(payload->>'user_id')::uuid and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access changed'; end if;
  -- Serialize reconnects for this store. Unique seller_id also prevents cross-store duplication.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,0));
  select * into c from fulfillment_private.ebay_connections where store_id=target for update;
  if found and c.seller_id<>payload->>'seller_id' then raise exception 'Disconnect existing seller before replacing store connection'; end if;
  if exists(select 1 from fulfillment_private.ebay_connections where seller_id=payload->>'seller_id' and store_id<>target) then raise exception 'Seller already connected to another store'; end if;
  secret_id=c.token_secret_id;
  if secret_id is null then select vault.create_secret((payload->'tokens')::text,'ebay_store_'||target::text) into secret_id;
  else perform vault.update_secret(secret_id,(payload->'tokens')::text); end if;
  insert into fulfillment_private.ebay_connections(store_id,seller_id,username,token_secret_id,connected_by,scopes,access_expires_at,refresh_expires_at)
  values(target,payload->>'seller_id',payload->>'username',secret_id,(payload->>'user_id')::uuid,payload->'scopes',now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer),now()+make_interval(secs=>(payload->'tokens'->>'refresh_token_expires_in')::integer))
  on conflict(store_id) do update set username=excluded.username,connected_by=excluded.connected_by,scopes=excluded.scopes,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,updated_at=now();
  return jsonb_build_object('connected',true);
 end if;
 raise exception 'Unsupported connection operation';
end $$;
revoke all on function public.ebay_connection_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_connection_worker(text,jsonb) to service_role;
