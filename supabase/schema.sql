-- Fulfillment authentication and access request schema
-- Run this once in Supabase Dashboard > SQL Editor.
-- Never place a Supabase service_role key in the website.

create extension if not exists pgcrypto;

do $$ begin
  create type public.fulfillment_role as enum ('admin', 'staff', 'investor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.requested_fulfillment_role as enum ('staff', 'investor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.access_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role public.fulfillment_role not null default 'staff',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  store_id uuid references public.stores(id) on delete set null
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  requested_role public.requested_fulfillment_role not null,
  message text not null default '' check (char_length(message) <= 200),
  status public.access_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  store_name text,
  constraint access_requests_investor_store_required check (requested_role <> 'investor' or nullif(btrim(store_name),'') is not null)
);

create index if not exists access_requests_status_created_idx
  on public.access_requests (status, created_at desc);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  name_normalized text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored unique,
  created_at timestamptz not null default now()
);


create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  reason text not null default '' check (char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists account_deletion_requests_pending_idx
  on public.account_deletion_requests(status, created_at desc);

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  );
$$;

create or replace function public.provision_fulfillment_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, email, display_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'staff',
    false
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_fulfillment_profile on auth.users;
create trigger on_auth_user_created_fulfillment_profile
after insert on auth.users
for each row execute procedure public.provision_fulfillment_profile();

alter table public.profiles enable row level security;
alter table public.access_requests enable row level security;
alter table public.stores enable row level security;
alter table public.account_deletion_requests enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

revoke all on table public.access_requests from anon, authenticated;
revoke all on table public.access_requests from anon, authenticated;
grant select, update (status) on table public.access_requests to authenticated;
revoke all on table public.stores from anon, authenticated;
grant select on table public.stores to authenticated;
revoke all on table public.account_deletion_requests from anon, authenticated;
grant select, insert on table public.account_deletion_requests to authenticated;
grant update (status, reviewed_at) on table public.account_deletion_requests to authenticated;

drop policy if exists "profile owner or admin can read" on public.profiles;
create policy "profile owner or admin can read"
on public.profiles for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());

drop policy if exists "admin can update profiles" on public.profiles;
create policy "admin can update profiles"
on public.profiles for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "public can submit pending access request" on public.access_requests;
create policy "public can submit pending access request"
on public.access_requests for insert to anon, authenticated
with check (status = 'pending');

drop policy if exists "admin can read access requests" on public.access_requests;
create policy "admin can read access requests"
on public.access_requests for select to authenticated
using (public.is_active_admin());

drop policy if exists "admin can update access request status" on public.access_requests;
create policy "admin can update access request status"
on public.access_requests for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


drop policy if exists "members can read their assigned store" on public.stores;
create policy "members can read their assigned store"
on public.stores for select to authenticated
using (
  public.is_active_admin()
  or exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.store_id = stores.id and p.is_active)
);

drop policy if exists "users can submit their own deletion request" on public.account_deletion_requests;
create policy "users can submit their own deletion request"
on public.account_deletion_requests for insert to authenticated
with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "users and admins can read deletion requests" on public.account_deletion_requests;
create policy "users and admins can read deletion requests"
on public.account_deletion_requests for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());

drop policy if exists "admins can review deletion requests" on public.account_deletion_requests;
create policy "admins can review deletion requests"
on public.account_deletion_requests for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


-- Securely dispatch owner status changes from Table Editor to the Edge Function.
create extension if not exists pg_net;

do $
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'fulfillment_webhook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'fulfillment_webhook_secret',
      'Authenticates private Fulfillment status automation calls'
    );
  end if;
end
$;

create or replace function public.verify_fulfillment_webhook(candidate text)
returns boolean language sql stable security definer set search_path = ''
as $
  select coalesce(candidate is not null and exists (
    select 1 from vault.decrypted_secrets
    where name = 'fulfillment_webhook_secret' and decrypted_secret = candidate
  ), false);
$;
revoke all on function public.verify_fulfillment_webhook(text) from public, anon, authenticated;
grant execute on function public.verify_fulfillment_webhook(text) to service_role;

create or replace function public.dispatch_fulfillment_status_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $
declare webhook_secret text;
begin
  if old.status = new.status or new.status = 'pending' then return new; end if;
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets where name = 'fulfillment_webhook_secret' limit 1;
  if webhook_secret is null then
    raise warning 'Fulfillment workflow webhook secret is not configured';
    return new;
  end if;
  perform net.http_post(
    url := 'https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/fulfillment-access',
    headers := jsonb_build_object('Content-Type','application/json','x-fulfillment-webhook-secret',webhook_secret),
    body := jsonb_build_object('action','process_database_event','table',tg_table_name,'record',to_jsonb(new),'old_record',to_jsonb(old)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$;
revoke all on function public.dispatch_fulfillment_status_event() from public, anon, authenticated;
drop trigger if exists access_request_status_dispatch on public.access_requests;
create trigger access_request_status_dispatch after update of status on public.access_requests
for each row execute function public.dispatch_fulfillment_status_event();
drop trigger if exists account_deletion_status_dispatch on public.account_deletion_requests;
create trigger account_deletion_status_dispatch after update of status on public.account_deletion_requests
for each row execute function public.dispatch_fulfillment_status_event();

-- Owner bootstrap (run only after creating the owner's Auth user):
-- Replace the UUID, email, and display name, then run this separately in SQL Editor:
--
-- insert into public.profiles (user_id, email, display_name, role, is_active)
-- values ('OWNER_AUTH_USER_UUID', 'owner@fulfillment.site', 'Owner Name', 'admin', true)
-- on conflict (user_id) do update set
--   email = excluded.email,
--   display_name = excluded.display_name,
--   role = 'admin',
--   is_active = true,
--   updated_at = now();
--
-- New Auth users are provisioned as inactive staff by default. After approving
-- a request, set the profile role to 'staff' or 'investor' and is_active=true.
