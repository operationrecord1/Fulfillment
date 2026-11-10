-- Match the password recovery cooldowns to the user-facing timer plan.
-- Requests 1-5: 59 seconds; 6-10: 1 minute 50 seconds; 11-19: 4 minutes 59 seconds.
-- Request 20 keeps the existing 24-hour lock.
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
