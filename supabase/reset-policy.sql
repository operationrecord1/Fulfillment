-- Account-based recovery throttling.  Every Supabase Auth recovery email updates
-- auth.users.recovery_sent_at, regardless of the client/browser that requested it.
create table if not exists public.password_reset_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_allowed_at timestamptz,
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.password_reset_attempts enable row level security;
revoke all on public.password_reset_attempts from public, anon, authenticated;

create or replace function public.enforce_password_reset_policy()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  state public.password_reset_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
  next_attempt integer;
  delay_seconds integer;
begin
  if new.recovery_sent_at is not distinct from old.recovery_sent_at
     or new.recovery_sent_at is null then
    return new;
  end if;

  insert into public.password_reset_attempts(user_id)
  values (new.id) on conflict (user_id) do nothing;

  select * into state from public.password_reset_attempts
  where user_id = new.id for update;

  if state.lock_until is not null and state.lock_until <= v_now then
    state.attempts := 0;
    state.next_allowed_at := null;
    state.lock_until := null;
  end if;

  if coalesce(state.lock_until, state.next_allowed_at) > v_now then
    raise exception 'Password reset temporarily unavailable'
      using errcode = 'P0001';
  end if;

  next_attempt := state.attempts + 1;
  if next_attempt >= 20 then
    update public.password_reset_attempts
    set attempts = 20, next_allowed_at = null,
        lock_until = v_now + interval '24 hours', updated_at = v_now
    where user_id = new.id;
  else
    delay_seconds := case when next_attempt <= 5 then 59
                          when next_attempt <= 10 then 110 else 299 end;
    update public.password_reset_attempts
    set attempts = next_attempt,
        next_allowed_at = v_now + make_interval(secs => delay_seconds),
        lock_until = null, updated_at = v_now
    where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_password_reset_policy() from public, anon, authenticated;
drop trigger if exists enforce_fulfillment_password_reset on auth.users;
create trigger enforce_fulfillment_password_reset
before update of recovery_sent_at on auth.users
for each row execute function public.enforce_password_reset_policy();

-- Public status reports only the next permitted time, never the attempt count.
-- An unknown address receives a neutral 60-second response without a DB row.
create or replace function public.password_reset_retry_at(account_email text)
returns timestamptz language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare
  deadline timestamptz;
begin
  if account_email is null or length(account_email) > 254 then
    return null;
  end if;
  select coalesce(a.lock_until, a.next_allowed_at) into deadline
  from auth.users u
  join public.password_reset_attempts a on a.user_id = u.id
  where lower(u.email) = lower(trim(account_email))
  limit 1;
  if deadline <= clock_timestamp() then return null; end if;
  return deadline;
end;
$$;

revoke all on function public.password_reset_retry_at(text) from public;
grant execute on function public.password_reset_retry_at(text) to anon, authenticated;
