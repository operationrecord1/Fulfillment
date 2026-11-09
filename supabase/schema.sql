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
  updated_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  requested_role public.requested_fulfillment_role not null,
  message text not null default '',
  status public.access_request_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists access_requests_status_created_idx
  on public.access_requests (status, created_at desc);

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

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, role, is_active) on table public.profiles to authenticated;

revoke all on table public.access_requests from anon, authenticated;
grant insert on table public.access_requests to anon, authenticated;
grant select, update (status) on table public.access_requests to authenticated;

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
