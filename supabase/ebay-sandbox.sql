-- Isolated Sandbox state. This RPC is available only to the authenticated server.
create table fulfillment_private.ebay_sandbox_connections (
 actor uuid primary key references public.profiles(user_id) on delete cascade,
 username text not null, secret_id uuid not null, connected_at timestamptz not null default now()
);
create table fulfillment_private.ebay_sandbox_config (actor uuid primary key references public.profiles(user_id), secret_id uuid not null);
create table fulfillment_private.ebay_sandbox_oauth (state_hash text primary key, actor uuid not null references public.profiles(user_id), expires_at timestamptz not null default now()+interval '10 minutes');
alter table fulfillment_private.ebay_sandbox_config enable row level security;
alter table fulfillment_private.ebay_sandbox_oauth enable row level security;
revoke all on fulfillment_private.ebay_sandbox_config,fulfillment_private.ebay_sandbox_oauth from public,anon,authenticated;
create table fulfillment_private.ebay_sandbox_actions (
 actor uuid not null references public.profiles(user_id), kind text not null, target text not null,
 attempt uuid not null, state text not null check(state in ('unknown','confirmed','rejected')),
 requested jsonb not null default '{}', updated_at timestamptz not null default now(),
 primary key(actor,kind,target)
);
create table fulfillment_private.ebay_sandbox_events (
 id bigint generated always as identity primary key, actor uuid not null references public.profiles(user_id),
 action text not null, outcome text not null, detail text not null, created_at timestamptz not null default now()
);
create index ebay_sandbox_events_actor_time on fulfillment_private.ebay_sandbox_events(actor,created_at desc);
alter table fulfillment_private.ebay_sandbox_connections enable row level security;
alter table fulfillment_private.ebay_sandbox_actions enable row level security;
alter table fulfillment_private.ebay_sandbox_events enable row level security;
revoke all on fulfillment_private.ebay_sandbox_connections,fulfillment_private.ebay_sandbox_actions,fulfillment_private.ebay_sandbox_events from public,anon,authenticated;
create or replace function public.ebay_sandbox_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid=nullif(payload->>'actor','')::uuid; c fulfillment_private.ebay_sandbox_connections; a fulfillment_private.ebay_sandbox_actions; sid uuid; aid uuid;
begin
 if action='consume' then
  delete from fulfillment_private.ebay_sandbox_oauth where state_hash=payload->>'hash' and expires_at>now() returning actor into uid;
  if uid is null then raise exception 'Authorization expired'; end if;
 end if;
 if not exists(select 1 from public.profiles where user_id=uid and is_active and role in ('admin','staff')) then raise exception 'Active employee required'; end if;
 select * into c from fulfillment_private.ebay_sandbox_connections where actor=uid;
 if action='consume' then return jsonb_build_object('actor',uid);
 elsif action='configure' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sandbox-config:'||uid::text,0));
  select secret_id into sid from fulfillment_private.ebay_sandbox_config where actor=uid;
  if sid is null then select vault.create_secret((payload->'config')::text,'ebay_sandbox_config_'||uid::text) into sid;
  else perform vault.update_secret(sid,(payload->'config')::text); end if;
  insert into fulfillment_private.ebay_sandbox_config(actor,secret_id) values(uid,sid) on conflict(actor) do nothing; return '{}';
 elsif action='credentials' then return coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where id=(select secret_id from fulfillment_private.ebay_sandbox_config where actor=uid)),'{}');
 elsif action='begin' then
  delete from fulfillment_private.ebay_sandbox_oauth where actor=uid or expires_at<now();
  insert into fulfillment_private.ebay_sandbox_oauth(state_hash,actor) values(payload->>'hash',uid); return '{}';
 elsif action='status' then return jsonb_build_object('connected',c.actor is not null,'username',c.username,'connected_at',c.connected_at,'configured',exists(select 1 from fulfillment_private.ebay_sandbox_config where actor=uid));
 elsif action='connect' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sandbox:'||uid::text,0));
  select * into c from fulfillment_private.ebay_sandbox_connections where actor=uid for update;
  if c.actor is not null and lower(c.username)<>lower(payload->>'username') then raise exception 'Reconnect the same Sandbox seller'; end if;
  if nullif(payload->'tokens'->>'access_token','') is null or nullif(payload->>'username','') is null then raise exception 'Verified connection required'; end if;
  sid=c.secret_id;
  if sid is null then select vault.create_secret((payload->'tokens')::text,'ebay_sandbox_user_'||uid::text) into sid;
  else perform vault.update_secret(sid,(payload->'tokens')::text); end if;
  insert into fulfillment_private.ebay_sandbox_connections(actor,username,secret_id) values(uid,payload->>'username',sid)
  on conflict(actor) do update set connected_at=now();
  return jsonb_build_object('connected',true,'username',payload->>'username');
 elsif action='token' then
  if c.actor is null then raise exception 'Sandbox connection required'; end if;
  return jsonb_build_object('username',c.username,'tokens',(select decrypted_secret::jsonb from vault.decrypted_secrets where id=c.secret_id));
 elsif action='events' then
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,action,outcome,detail,created_at from fulfillment_private.ebay_sandbox_events where actor=uid order by created_at desc limit 50)x),'[]');
 elsif action='event' then
  insert into fulfillment_private.ebay_sandbox_events(actor,action,outcome,detail) values(uid,left(payload->>'name',60),left(payload->>'outcome',40),left(payload->>'detail',600)); return '{}';
 elsif action='claim' then
  aid=gen_random_uuid();
  insert into fulfillment_private.ebay_sandbox_actions(actor,kind,target,attempt,state,requested) values(uid,payload->>'kind',payload->>'target',aid,'unknown',payload->'requested')
  on conflict(actor,kind,target) do update set attempt=excluded.attempt,state='unknown',requested=excluded.requested,updated_at=now()
  where fulfillment_private.ebay_sandbox_actions.state='rejected' or (fulfillment_private.ebay_sandbox_actions.kind='listing' and fulfillment_private.ebay_sandbox_actions.state='confirmed') returning * into a;
  return jsonb_build_object('claimed',a.actor is not null,'attempt',a.attempt);
 elsif action='action' then
  select * into a from fulfillment_private.ebay_sandbox_actions where actor=uid and kind=payload->>'kind' and target=payload->>'target';
  return coalesce(to_jsonb(a),'{}');
 elsif action='finish' then
  update fulfillment_private.ebay_sandbox_actions set state=payload->>'state',updated_at=now()
   where actor=uid and kind=payload->>'kind' and target=payload->>'target' and attempt=(payload->>'attempt')::uuid;
  return '{}';
 end if;
 raise exception 'Unsupported Sandbox operation';
end $$;
revoke all on function public.ebay_sandbox_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_sandbox_worker(text,jsonb) to service_role;
