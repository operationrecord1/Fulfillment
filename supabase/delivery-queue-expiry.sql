create function fulfillment_private.due_delivery_ids(target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 delete from fulfillment_private.delivery_due q where q.store_id=target and not exists(
 select 1 from fulfillment_private.ebay_records o where o.store_id=q.store_id and o.resource='orders' and o.external_id=q.order_id
 and o.data->>'creationDate'>=to_char((now()-interval '89 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'));
 select coalesce(jsonb_agg(order_id order by next_check,order_id),'[]') into result from (
 select order_id,next_check from fulfillment_private.delivery_due where store_id=target and next_check<=now() order by next_check,order_id limit 50) q;
 return result;
end $$;
revoke all on function fulfillment_private.due_delivery_ids(uuid) from public,anon,authenticated;
do $$ declare def text;needle text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='ebay_sync_worker';
 needle='coalesce((select jsonb_agg(external_id order by external_id) from (select order_id as external_id from fulfillment_private.delivery_due where store_id=j.store_id and next_check<=now() order by next_check,order_id limit 50) q),''[]''::jsonb)';
 if position(needle in def)=0 then raise exception 'Queue selector changed';end if;
 execute replace(def,needle,'fulfillment_private.due_delivery_ids(j.store_id)');
end $$;
