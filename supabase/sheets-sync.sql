-- Google mirror. Source rows remain authoritative. No foreign key cascades to targets.
create table fulfillment_private.sheets_targets (
 employee_id uuid primary key,
 serial bigint generated always as identity unique,
 store_id uuid,
 store_name text not null,
 spreadsheet_id text unique,
 create_started_at timestamptz,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table fulfillment_private.sheets_jobs (
 employee_id uuid not null references fulfillment_private.sheets_targets(employee_id),
 year integer not null check(year between 2000 and 2100),
 version bigint not null default 1,
 completed_version bigint not null default 0,
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 last_error text,
 synced_at timestamptz,
 extents jsonb not null default '{}'::jsonb,
 progress jsonb not null default '{}'::jsonb,
 primary key(employee_id,year)
);
create table fulfillment_private.sheets_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 lease_token uuid,
 lease_until timestamptz,
 next_dispatch timestamptz not null default now()
);
insert into fulfillment_private.sheets_control(singleton) values(true);
create table fulfillment_private.sheets_oauth_states (
 state_hash text primary key,
 verifier text not null,
 expires_at timestamptz not null
);
alter table fulfillment_private.sheets_targets enable row level security;
alter table fulfillment_private.sheets_jobs enable row level security;
alter table fulfillment_private.sheets_control enable row level security;
alter table fulfillment_private.sheets_oauth_states enable row level security;
revoke all on fulfillment_private.sheets_targets,fulfillment_private.sheets_jobs,fulfillment_private.sheets_control,fulfillment_private.sheets_oauth_states from public,anon,authenticated;

create function fulfillment_private.sheets_enqueue(employee uuid,yr integer) returns void
language sql security definer set search_path='' as $$
 insert into fulfillment_private.sheets_jobs(employee_id,year)
 select employee,yr where yr between 2000 and 2100
 on conflict(employee_id,year) do update set version=fulfillment_private.sheets_jobs.version+1,
 available_at=least(fulfillment_private.sheets_jobs.available_at,now());
$$;

create function fulfillment_private.sheets_profile_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; yr integer; name text;
begin
 if tg_op='DELETE' then
  update fulfillment_private.sheets_targets set active=false where employee_id=old.user_id;
  return old;
 end if;
 if new.role::text<>'staff' or not new.is_active then
  update fulfillment_private.sheets_targets set active=false where employee_id=new.user_id;
  return new;
 end if;
 select s.name into name from public.stores s where s.id=new.store_id;
 update fulfillment_private.sheets_targets set active=true,store_id=new.store_id,
 store_name=coalesce(name,nullif(new.display_name,''),'Employee') where employee_id=new.user_id;
 if not found then
  insert into fulfillment_private.sheets_targets(employee_id,store_id,store_name)
  values(new.user_id,new.store_id,coalesce(name,nullif(new.display_name,''),'Employee'));
 end if;
 for yr in select extract(year from now() at time zone 'Asia/Dhaka')::integer
 union select r.year from fulfillment_private.order_rows r where r.store_id=new.store_id
 union select j.year from fulfillment_private.sheets_jobs j where j.employee_id=new.user_id
 loop perform fulfillment_private.sheets_enqueue(new.user_id,yr);end loop;
 return new;
end $$;
create trigger sheets_profile_changed after insert or update of is_active,role,store_id,display_name or delete
on public.profiles for each row execute function fulfillment_private.sheets_profile_changed();

create function fulfillment_private.sheets_period_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare employee uuid;
begin
 for employee in select employee_id from fulfillment_private.sheets_targets where active and store_id=new.store_id
 loop perform fulfillment_private.sheets_enqueue(employee,new.year);end loop;
 return new;
end $$;
create trigger sheets_period_changed after insert or update on fulfillment_private.order_periods
for each row execute function fulfillment_private.sheets_period_changed();

-- Safe, authenticated year provisioning; no Google credentials reach the browser.
create function public.sheets_ensure_year(yr integer) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active and role='staff';
 if p.user_id is null or yr not between 2000 and 2100 or yr is null then return;end if;
 insert into fulfillment_private.sheets_jobs(employee_id,year)
 select p.user_id,yr where exists(select 1 from fulfillment_private.sheets_targets where employee_id=p.user_id and active)
 on conflict do nothing;
end $$;
revoke all on function public.sheets_ensure_year(integer) from public,anon;
grant execute on function public.sheets_ensure_year(integer) to authenticated;

-- Worker RPC is service-only; one global lease serializes writes for the owner account.
create function public.sheets_worker(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token uuid; job fulfillment_private.sheets_jobs; target fulfillment_private.sheets_targets;
 cfg fulfillment_private.sheets_control; result jsonb; secret_id uuid;
begin
 if action='claim' then
  select * into cfg from fulfillment_private.sheets_control where singleton for update;
  if not cfg.enabled or cfg.lease_until>now() then return null;end if;
  select j.* into job from fulfillment_private.sheets_jobs j join fulfillment_private.sheets_targets t using(employee_id)
  where t.active and j.version>j.completed_version and j.available_at<=now()
  order by j.available_at,j.employee_id,j.year limit 1;
  if not found then return null;end if;
  token:=gen_random_uuid();
  update fulfillment_private.sheets_control set lease_token=token,lease_until=now()+interval '5 minutes' where singleton;
  select * into target from fulfillment_private.sheets_targets where employee_id=job.employee_id;
  return jsonb_build_object('token',token,'job',to_jsonb(job),'target',to_jsonb(target),
   'rows',coalesce((select jsonb_agg(r order by r.month,r.position) from fulfillment_private.order_rows r
    where r.store_id=target.store_id and r.year=job.year and r.deleted_at is null),'[]'::jsonb));
 elsif action='snapshot' then
  select * into target from fulfillment_private.sheets_targets where employee_id=(payload->>'employee_id')::uuid;
  select * into job from fulfillment_private.sheets_jobs where employee_id=target.employee_id and year=(payload->>'year')::integer;
  if target.employee_id is null or job.employee_id is null then raise exception 'Mirror not found';end if;
  return jsonb_build_object('target',to_jsonb(target),'job',to_jsonb(job),
   'rows',coalesce((select jsonb_agg(r order by r.month,r.position) from fulfillment_private.order_rows r where r.store_id=target.store_id and r.year=job.year and r.deleted_at is null),'[]'::jsonb));
 elsif action='credentials' then
  return coalesce((select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets
   where name in ('sheets_google_client_id','sheets_google_client_secret','sheets_google_refresh_token')),'{}'::jsonb);
 elsif action='oauth_begin' then
  delete from fulfillment_private.sheets_oauth_states where expires_at<now();
  insert into fulfillment_private.sheets_oauth_states values(payload->>'hash',payload->>'verifier',now()+interval '10 minutes');return '{}'::jsonb;
 elsif action='oauth_consume' then
  delete from fulfillment_private.sheets_oauth_states where state_hash=payload->>'hash' and expires_at>now() returning jsonb_build_object('verifier',verifier) into result;
  return result;
 elsif action='oauth_save' then
  if payload->>'email'<>'operation.record1@gmail.com' or length(coalesce(payload->>'refresh_token',''))<20 then raise exception 'Wrong owner or missing token';end if;
  select id into secret_id from vault.secrets where name='sheets_google_refresh_token';
  if secret_id is null then perform vault.create_secret(payload->>'refresh_token','sheets_google_refresh_token');
  else perform vault.update_secret(secret_id,payload->>'refresh_token');end if;
  -- Enable explicitly after the first controlled verification, not during authorization.
  return '{"connected":true}'::jsonb;
 end if;
 select * into cfg from fulfillment_private.sheets_control where singleton for update;
 if cfg.lease_token is distinct from (payload->>'token')::uuid or cfg.lease_until<now() then raise exception 'Worker lease expired';end if;
 select * into target from fulfillment_private.sheets_targets where employee_id=(payload->>'employee_id')::uuid;
 if action='check' then return jsonb_build_object('active',target.active and exists(select 1 from public.profiles where user_id=target.employee_id and is_active and role='staff'));
 elsif action='prepare_create' then
  if not target.active or target.create_started_at is not null then raise exception 'Spreadsheet creation requires reconciliation';end if;
  update fulfillment_private.sheets_targets set create_started_at=now() where employee_id=target.employee_id;
 elsif action='bind' then
  if not target.active then raise exception 'Employee archived';end if;
  if target.spreadsheet_id is not null and target.spreadsheet_id<>payload->>'spreadsheet_id' then raise exception 'Spreadsheet already bound';end if;
  update fulfillment_private.sheets_targets set spreadsheet_id=payload->>'spreadsheet_id',create_started_at=null where employee_id=target.employee_id;
 elsif action='finish' then
  update fulfillment_private.sheets_jobs set completed_version=(payload->>'version')::bigint,attempts=0,last_error=null,synced_at=now(),extents=payload->'extents',progress='{}'::jsonb
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='checkpoint' then
  update fulfillment_private.sheets_jobs set progress=payload->'progress',extents=payload->'extents'
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='yield' then
  update fulfillment_private.sheets_jobs set available_at=now(),last_error=null
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='fail' then
  update fulfillment_private.sheets_jobs set attempts=attempts+1,last_error=left(payload->>'error',300),
   available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 else raise exception 'Invalid worker action';end if;
 if action in ('finish','fail','yield') then update fulfillment_private.sheets_control set lease_token=null,lease_until=null where singleton;end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.sheets_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.sheets_worker(text,jsonb) to service_role;
revoke all on function fulfillment_private.sheets_enqueue(uuid,integer),fulfillment_private.sheets_profile_changed(),fulfillment_private.sheets_period_changed() from public,anon,authenticated;

-- Deterministic initial serial allocation; existing active employees only.
insert into fulfillment_private.sheets_targets(employee_id,store_id,store_name)
select p.user_id,p.store_id,coalesce(s.name,nullif(p.display_name,''),'Employee')
from public.profiles p left join public.stores s on s.id=p.store_id
where p.role='staff' and p.is_active order by p.created_at,p.user_id;
insert into fulfillment_private.sheets_jobs(employee_id,year)
select t.employee_id,y.year from fulfillment_private.sheets_targets t cross join lateral
(select extract(year from now() at time zone 'Asia/Dhaka')::integer as year union select r.year from fulfillment_private.order_rows r where r.store_id=t.store_id) y;
