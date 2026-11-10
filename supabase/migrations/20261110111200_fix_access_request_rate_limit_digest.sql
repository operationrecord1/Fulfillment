-- Use the pgcrypto extension's installed schema and bytea overload explicitly.
create or replace function public.reserve_access_request_slot(request_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  normalized text := lower(trim(request_email));
  hashed_email text := encode(extensions.digest(convert_to(normalized, 'UTF8'), 'sha256'), 'hex');
  reserved_at timestamptz;
begin
  if normalized = '' then return false; end if;
  insert into public.access_request_rate_limits(email_hash, last_submitted_at)
  values (hashed_email, now())
  on conflict (email_hash) do update
    set last_submitted_at = excluded.last_submitted_at
    where public.access_request_rate_limits.last_submitted_at < now() - interval '2 minutes'
  returning last_submitted_at into reserved_at;
  return reserved_at is not null;
end;
$function$;

revoke execute on function public.reserve_access_request_slot(text) from public, anon, authenticated;
grant execute on function public.reserve_access_request_slot(text) to service_role;
