alter table fulfillment_private.ebay_sync_jobs add column if not exists reset_requested boolean not null default false;
alter table fulfillment_private.ebay_sync_jobs add column if not exists requested_at timestamptz;

create or replace function public.ebay_workspace_page(target uuid,kind text default 'orders',query_text text default '',status_filter text default '',page_number integer default 1,page_size integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; n integer:=greatest(1,page_number); size integer:=least(100,greatest(10,page_size));
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if kind not in ('orders','listings') then raise exception 'Unsupported page'; end if;
 with records as (
  select r.external_id,r.data,r.updated_at,
   case when kind='listings' then case when r.data->>'catalog_present'='false' then 'UNAVAILABLE' else r.data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}' end else case when r.data#>>'{cancelStatus,cancelState}'='CANCELED' then 'CANCELLED' else r.data->>'orderFulfillmentStatus' end end as state,
   case when kind='listings' then r.data#>>'{listing,sellerProduct,title}' else (select string_agg(x->>'title',' ') from jsonb_array_elements(r.data->'lineItems') x) end as title,
   case when kind='orders' then r.data->>'creationDate' else r.data#>>'{listing,listingTerms,lifecycleTerms,startAt}' end as created
  from fulfillment_private.ebay_records r where r.store_id=target and r.resource=kind
 ), filtered as (select * from records where (status_filter='' or state=status_filter) and (query_text='' or external_id ilike '%'||left(query_text,160)||'%' or title ilike '%'||left(query_text,160)||'%' or data->'buyer'->>'username' ilike '%'||left(query_text,160)||'%')),
 paged as (select * from filtered order by created desc nulls last,external_id desc limit size offset (n-1)*size)
 select jsonb_build_object('total',(select count(*) from filtered),'counts',(select coalesce(jsonb_object_agg(state,c),'{}') from (select coalesce(state,'UNKNOWN') state,count(*) c from records group by 1) c),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.external_id,'data',p.data,'updated_at',p.updated_at,'image',case when kind='orders' then (select l.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' from fulfillment_private.ebay_records l where l.store_id=target and l.resource='listings' and l.external_id=p.data#>>'{lineItems,0,legacyItemId}' limit 1) else p.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' end,'traffic',case when kind='listings' then (select t.data from fulfillment_private.ebay_records t where t.store_id=target and t.resource='listing_traffic' and t.external_id=p.external_id) else null end) order by p.created desc nulls last,p.external_id desc) from paged p),'[]'),
 'sync',(select jsonb_build_object('last_success',last_success,'error',last_error,'running',coalesce(lease_until>now(),false) or reset_requested or cursor<>'{}'::jsonb,'requested_at',requested_at) from fulfillment_private.ebay_sync_jobs where store_id=target and resource=kind),
 'analytics_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='listing_traffic'),
 'events',jsonb_build_object('enabled',(select count(*)=4 from fulfillment_private.ebay_notification_subscriptions where store_id=target and status='ENABLED' and topic in ('LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY')),'pending',(select count(*) from fulfillment_private.ebay_notification_inbox where store_id=target and disposition='pending'),'last_received',(select max(received_at) from fulfillment_private.ebay_notification_inbox where store_id=target),'last_processed',(select max(processed_at) from fulfillment_private.ebay_notification_inbox where store_id=target)),
 'seller',(select username from fulfillment_private.ebay_connections where store_id=target),'store',(select name from public.stores where id=target)) into result;
 return result;
end $$;
revoke all on function public.ebay_workspace_page(uuid,text,text,text,integer,integer) from public,anon;
grant execute on function public.ebay_workspace_page(uuid,text,text,text,integer,integer) to authenticated;

create or replace function public.ebay_resync_store(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if not exists(select 1 from fulfillment_private.ebay_connections where store_id=target) then raise exception 'Connect your eBay store first'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ebay_resync_'||target::text,0));
 if exists(select 1 from fulfillment_private.ebay_sync_jobs where store_id=target and requested_at>now()-interval '60 seconds') then return jsonb_build_object('queued',true,'already_queued',true); end if;
 update fulfillment_private.ebay_sync_jobs set reset_requested=resource in ('orders','listings'),requested_at=now(),available_at=now() where store_id=target and resource in ('orders','listings');
 perform fulfillment_private.ebay_dispatch();
 return jsonb_build_object('queued',true);
end $$;
revoke all on function public.ebay_resync_store(uuid) from public,anon;
grant execute on function public.ebay_resync_store(uuid) to authenticated;
