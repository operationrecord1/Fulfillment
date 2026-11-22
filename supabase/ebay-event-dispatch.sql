create function fulfillment_private.ebay_release_events() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Release only stores/resources with authenticated pending events. API retries retain backoff.
 update fulfillment_private.ebay_sync_jobs j set available_at=least(j.available_at,now()),
 watermark=case when j.cursor='{}'::jsonb and j.watermark is not null then least(j.watermark,e.earliest_event) else j.watermark end
 from (select store_id,resource,min(event_at) earliest_event from fulfillment_private.ebay_notification_inbox
       where disposition='pending' and processed_at is null and store_id is not null group by store_id,resource) e
 where j.store_id=e.store_id and j.resource=e.resource and j.last_error is null and coalesce(j.lease_until,now())<=now();
 perform fulfillment_private.ebay_dispatch();
end $$;
revoke all on function fulfillment_private.ebay_release_events() from public,anon,authenticated;
select cron.schedule('fulfillment-ebay-event-batch','*/2 * * * *','select fulfillment_private.ebay_release_events()');
-- Occasional reconciliation recovers missed eBay deliveries; it does not drive the event loop.
-- Setup is idempotent and provisions subscriptions for newly connected stores automatically.
create function fulfillment_private.ebay_setup_notifications() returns void
language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='fulfillment_webhook_secret';
 if secret is null then return; end if;
 perform net.http_post(url:='https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/ebay-notifications/setup',headers:=jsonb_build_object('Content-Type','application/json','x-fulfillment-webhook-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=120000);
end $$;
revoke all on function fulfillment_private.ebay_setup_notifications() from public,anon,authenticated;
select cron.schedule('fulfillment-ebay-subscriptions','*/10 * * * *','select fulfillment_private.ebay_setup_notifications()');
create function fulfillment_private.ebay_connect_events() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform fulfillment_private.ebay_setup_notifications();
 return new;
end $$;
revoke all on function fulfillment_private.ebay_connect_events() from public,anon,authenticated;
create trigger ebay_connect_events after insert or update of connected_by on fulfillment_private.ebay_connections
for each row execute function fulfillment_private.ebay_connect_events();
