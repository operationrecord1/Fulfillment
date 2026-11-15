-- Run after sheets-sync.sql and deployment. Disabled control prevents premature export.
create extension if not exists pg_cron;
create function fulfillment_private.sheets_dispatch() returns void
language plpgsql security definer set search_path='' as $$
declare secret text; allowed boolean;
begin
 update fulfillment_private.sheets_control set next_dispatch=now()+interval '20 seconds'
 where singleton and enabled and next_dispatch<=now() and (lease_until is null or lease_until<=now())
 and exists(select 1 from fulfillment_private.sheets_jobs j join fulfillment_private.sheets_targets t using(employee_id)
 where t.active and j.version>j.completed_version and j.available_at<=now()) returning true into allowed;
 if not coalesce(allowed,false) then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='fulfillment_webhook_secret';
 if secret is null then return;end if;
 perform net.http_post(url:='https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/sheets-sync',
 headers:=jsonb_build_object('Content-Type','application/json','x-fulfillment-webhook-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=120000);
end $$;
create function fulfillment_private.sheets_job_ready() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform fulfillment_private.sheets_dispatch();return null;end $$;
create trigger sheets_job_ready after insert or update of version on fulfillment_private.sheets_jobs
for each statement execute function fulfillment_private.sheets_job_ready();
create function fulfillment_private.sheets_reconcile() returns void
language plpgsql security definer set search_path='' as $$
begin
 update fulfillment_private.sheets_jobs j set version=version+1,available_at=now()
 where exists(select 1 from fulfillment_private.sheets_targets t where t.employee_id=j.employee_id and t.active);
end $$;
create function fulfillment_private.sheets_store_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update fulfillment_private.sheets_targets set store_name=new.name where store_id=new.id and active;
 update fulfillment_private.sheets_jobs j set version=version+1,available_at=now()
 where exists(select 1 from fulfillment_private.sheets_targets t where t.employee_id=j.employee_id and t.store_id=new.id and t.active);
 return new;
end $$;
create trigger sheets_store_changed after update of name on public.stores
for each row execute function fulfillment_private.sheets_store_changed();
revoke all on function fulfillment_private.sheets_dispatch(),fulfillment_private.sheets_job_ready(),fulfillment_private.sheets_reconcile(),fulfillment_private.sheets_store_changed() from public,anon,authenticated;
select cron.schedule('fulfillment-sheets-retry','* * * * *','select fulfillment_private.sheets_dispatch()');
select cron.schedule('fulfillment-sheets-reconcile','17 20 * * *','select fulfillment_private.sheets_reconcile()');
