create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  name_normalized text generated always as (lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))) stored unique,
  created_at timestamptz not null default now()
);
alter table public.stores enable row level security;
revoke all on public.stores from anon, authenticated;
grant select on public.stores to authenticated;
create policy "members can read their assigned store"
  on public.stores for select to authenticated
  using (
    public.is_active_admin()
    or exists (select 1 from public.profiles p
               where p.user_id = auth.uid() and p.store_id = stores.id and p.is_active)
  );

alter table public.profiles add column if not exists store_id uuid references public.stores(id) on delete set null;
alter table public.access_requests add column if not exists store_name text;
alter table public.access_requests
  add constraint access_requests_investor_store_required
  check (requested_role <> 'investor' or nullif(btrim(store_name),'') is not null) not valid;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  reason text not null default '' check (char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists account_deletion_requests_pending_idx
  on public.account_deletion_requests(status, created_at desc);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select, insert on public.account_deletion_requests to authenticated;
grant update (status, reviewed_at) on public.account_deletion_requests to authenticated;
create policy "users can submit their own deletion request"
  on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "users and admins can read deletion requests"
  on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid() or public.is_active_admin());
create policy "admins can review deletion requests"
  on public.account_deletion_requests for update to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());
