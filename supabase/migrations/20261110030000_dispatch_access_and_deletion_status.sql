alter table public.account_deletion_requests alter column user_id drop not null;
alter table public.account_deletion_requests drop constraint if exists account_deletion_requests_user_id_fkey;
alter table public.account_deletion_requests
  add constraint account_deletion_requests_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'fulfillment_webhook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'fulfillment_webhook_secret',
      'Authenticates private Fulfillment status automation calls'
    );
  end if;
end
$$;

create or replace function public.verify_fulfillment_webhook(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(candidate is not null and exists (
    select 1 from vault.decrypted_secrets
    where name = 'fulfillment_webhook_secret' and decrypted_secret = candidate
  ), false);
$$;
revoke all on function public.verify_fulfillment_webhook(text) from public, anon, authenticated;
grant execute on function public.verify_fulfillment_webhook(text) to service_role;

create or replace function public.dispatch_fulfillment_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;
revoke all on function public.dispatch_fulfillment_status_event() from public, anon, authenticated;

drop trigger if exists access_request_status_dispatch on public.access_requests;
create trigger access_request_status_dispatch after update of status on public.access_requests
for each row execute function public.dispatch_fulfillment_status_event();
drop trigger if exists account_deletion_status_dispatch on public.account_deletion_requests;
create trigger account_deletion_status_dispatch after update of status on public.account_deletion_requests
for each row execute function public.dispatch_fulfillment_status_event();