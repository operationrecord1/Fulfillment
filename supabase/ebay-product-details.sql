create or replace function public.ebay_product_worker(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=(payload->>'store_id')::uuid; c fulfillment_private.ebay_connections; r fulfillment_private.ebay_records; t jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=(payload->>'actor')::uuid and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store Access Required'; end if;
 select * into r from fulfillment_private.ebay_records where store_id=target and resource='orders' and external_id=payload->>'order_id';
 if not found then raise exception 'Order Not Found'; end if;
 select * into c from fulfillment_private.ebay_connections where store_id=target;
 select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
 if action='context' then return jsonb_build_object('tokens',t,'access_expires_at',c.access_expires_at,'items',r.data->'lineItems');
 elsif action='token' then
  perform vault.update_secret(c.token_secret_id,(t||(payload->'tokens'))::text);
  update fulfillment_private.ebay_connections set access_expires_at=now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer) where store_id=target;
 else raise exception 'Invalid Operation'; end if;
 return '{}';
end $$;
revoke all on function public.ebay_product_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_product_worker(text,jsonb) to service_role;
drop function if exists public.ebay_note_connection_context();
