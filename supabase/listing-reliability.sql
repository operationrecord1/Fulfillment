alter table fulfillment_private.ebay_supplier_products add column if not exists buy_price numeric(12,2) check(buy_price>=0);
create table fulfillment_private.ebay_listing_changes(id bigint generated always as identity primary key,store_id uuid not null,item_id text not null,change_type text not null,old_value jsonb,new_value jsonb,changed_at timestamptz not null default now());
alter table fulfillment_private.ebay_listing_changes enable row level security;
create index on fulfillment_private.ebay_listing_changes(store_id,changed_at desc);
create table fulfillment_private.ebay_image_recovery(store_id uuid not null,item_id text not null,attempted_at timestamptz not null default now(),primary key(store_id,item_id));
alter table fulfillment_private.ebay_image_recovery enable row level security;
revoke all on fulfillment_private.ebay_listing_changes,fulfillment_private.ebay_image_recovery from public,anon,authenticated;
create function fulfillment_private.log_listing_change() returns trigger language plpgsql set search_path='' as $$
begin
 if new.resource<>'listings' then return new;end if;
 if TG_OP='INSERT' then insert into fulfillment_private.ebay_listing_changes(store_id,item_id,change_type,new_value) values(new.store_id,new.external_id,'Added',jsonb_build_object('active',new.data->'catalog_present'));
 else
 if (old.data->>'catalog_present') is distinct from (new.data->>'catalog_present') then insert into fulfillment_private.ebay_listing_changes(store_id,item_id,change_type,old_value,new_value) values(new.store_id,new.external_id,case when new.data->>'catalog_present'='false' then 'Removed' else 'Restored' end,old.data->'catalog_present',new.data->'catalog_present');end if;
 if (old.data#>'{listing,items,0,itemTerms,pricingTerms,fixedPrice,original}') is distinct from (new.data#>'{listing,items,0,itemTerms,pricingTerms,fixedPrice,original}') then insert into fulfillment_private.ebay_listing_changes(store_id,item_id,change_type,old_value,new_value) values(new.store_id,new.external_id,'Price Changed',old.data#>'{listing,items,0,itemTerms,pricingTerms,fixedPrice,original}',new.data#>'{listing,items,0,itemTerms,pricingTerms,fixedPrice,original}');end if;
 end if;return new;
end $$;
revoke all on function fulfillment_private.log_listing_change() from public,anon,authenticated;
create trigger log_listing_change after insert or update on fulfillment_private.ebay_records for each row when(new.resource='listings') execute function fulfillment_private.log_listing_change();
create function public.ebay_catalog_images_commit(target uuid,records jsonb,attempted text[] default '{}') returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 for r in select value from jsonb_array_elements(records) loop
 if r->>'id' !~ '^\d+$' then raise exception 'Invalid item';end if;
 insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values(target,'listings',r->>'id',r->'data') on conflict(store_id,resource,external_id) do update set data=fulfillment_private.ebay_records.data||jsonb_build_object('listing',jsonb_set(fulfillment_private.ebay_records.data->'listing','{sellerProduct}',excluded.data#>'{listing,sellerProduct}')),updated_at=now();
 end loop;
 insert into fulfillment_private.ebay_image_recovery(store_id,item_id) select target,unnest(attempted) on conflict(store_id,item_id) do update set attempted_at=now();
end $$;
revoke all on function public.ebay_catalog_images_commit(uuid,jsonb,text[]) from public,anon,authenticated;grant execute on function public.ebay_catalog_images_commit(uuid,jsonb,text[]) to service_role;
create function public.ebay_listing_details_save(target uuid,item_id text,product_asin text,buying_price numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or(role='staff' and store_id=target))) then raise exception 'Store access required';end if;
 if product_asin !~ '^[A-Z0-9]{10}$' or product_asin is null or buying_price<0 or buying_price>99999999 then raise exception 'Invalid supplier input';end if;
 if not exists(select 1 from fulfillment_private.ebay_records where store_id=target and resource='listings' and external_id=item_id) then raise exception 'Listing not found';end if;
 insert into fulfillment_private.ebay_supplier_products as sp(store_id,item_id,asin,buy_price) values(target,item_id,product_asin,buying_price) on conflict on constraint ebay_supplier_products_pkey do update set asin=excluded.asin,buy_price=excluded.buy_price,updated_at=now();
 return jsonb_build_object('asin',product_asin,'buy_price',buying_price);
end $$;
revoke all on function public.ebay_listing_details_save(uuid,text,text,numeric) from public,anon;grant execute on function public.ebay_listing_details_save(uuid,text,text,numeric) to authenticated;
create function public.ebay_listing_changes_get(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or(role='staff' and store_id=target))) then raise exception 'Store access required';end if;
 return coalesce((select jsonb_agg(x) from(select item_id,change_type,old_value,new_value,changed_at from fulfillment_private.ebay_listing_changes where store_id=target order by id desc limit 100)x),'[]');end $$;
revoke all on function public.ebay_listing_changes_get(uuid) from public,anon;grant execute on function public.ebay_listing_changes_get(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.ebay_sync_worker(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j fulfillment_private.ebay_sync_jobs; c fulfillment_private.ebay_connections; t jsonb; r jsonb; target uuid; token uuid;
begin
 if action='claim' then
  -- Serialize claim selection, including claims for different resources of one seller.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ebay_sync_claim',0));
  update fulfillment_private.ebay_sync_jobs set cursor='{}',watermark=null,reset_requested=false,available_at=now() where reset_requested and coalesce(lease_until,now())<=now();
  insert into fulfillment_private.ebay_sync_jobs(store_id,resource)
  select store_id,k from fulfillment_private.ebay_connections cross join unnest(array['orders','listings','returns','transactions','traffic','listing_traffic','orders_history','transactions_history','delivery_tracking']) k on conflict do nothing;
  select * into j from fulfillment_private.ebay_sync_jobs a where a.available_at<=now()
   and coalesce(a.lease_until,now())<=now()
   and (a.resource<>'listing_traffic' or exists(select 1 from fulfillment_private.ebay_sync_jobs l where l.store_id=a.store_id and l.resource='listings' and l.last_success is not null))
   and not exists(select 1 from fulfillment_private.ebay_sync_jobs b where b.store_id=a.store_id and b.lease_until>now())
   order by case when a.available_at<now()-interval '15 minutes' then -1 when a.resource='orders' then 0 when a.resource='listings' then 1 when a.resource in ('orders_history','transactions_history') then 3 else 2 end,a.available_at,a.store_id,a.resource for update skip locked limit 1;
  if not found then return null; end if;
  token=gen_random_uuid();
  update fulfillment_private.ebay_sync_jobs set lease_id=token,lease_until=now()+interval '90 seconds' where store_id=j.store_id and resource=j.resource;
  select * into c from fulfillment_private.ebay_connections where store_id=j.store_id;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  return to_jsonb(j)||jsonb_build_object('lease_id',token,'tokens',t,'access_expires_at',c.access_expires_at,'refresh_expires_at',c.refresh_expires_at,
   'image_ids',case when j.resource='orders' then coalesce((select jsonb_agg(item_id) from (select distinct r.data#>>'{lineItems,0,legacyItemId}' item_id from fulfillment_private.ebay_records r where r.store_id=j.store_id and r.resource='orders' and nullif(r.data#>>'{_orderSnapshot,image}','') is null and not exists(select 1 from fulfillment_private.ebay_image_recovery a where a.store_id=r.store_id and a.item_id=r.data#>>'{lineItems,0,legacyItemId}' and a.attempted_at>now()-interval '24 hours') limit 3) ids),'[]'::jsonb) else null end,
   'delivery_ids',case when j.resource='delivery_tracking' then fulfillment_private.due_delivery_ids(j.store_id) else null end,
   'listing_ids',case when j.resource='listing_traffic' then coalesce((select jsonb_agg(external_id order by external_id) from (select external_id from fulfillment_private.ebay_records where store_id=j.store_id and resource='listings' and external_id>coalesce(j.cursor->>'after','') order by external_id limit 50) x),'[]'::jsonb) else null end);
 end if;
 target=(payload->>'store_id')::uuid;
 select * into j from fulfillment_private.ebay_sync_jobs where store_id=target and resource=payload->>'resource' and lease_id=(payload->>'lease_id')::uuid and lease_until>now() for update;
 if not found then raise exception 'Sync lease expired'; end if;
 if action='token' then
  select * into c from fulfillment_private.ebay_connections where store_id=target for update;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  if length(payload->'tokens'->>'access_token')<10 or (payload->'tokens'->>'expires_in')::integer<=0 then raise exception 'Invalid token response'; end if;
  perform vault.update_secret(c.token_secret_id,(t||(payload->'tokens'))::text);
  update fulfillment_private.ebay_connections set access_expires_at=now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer),updated_at=now() where store_id=target;
 elsif action='commit' then
  for r in select value from jsonb_array_elements(payload->'records') loop
   if coalesce(r->>'id','')='' then raise exception 'Missing eBay record ID'; end if;
   if j.resource='listings' and payload ? 'snapshot' then
    insert into fulfillment_private.ebay_listing_stage values(target,payload#>>'{snapshot,id}',r->>'id',r->'data') on conflict(store_id,scan_id,external_id) do update set data=excluded.data;
   else
   insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values(target,case when j.resource='orders_history' then 'orders' when j.resource='transactions_history' then 'transactions' else j.resource end,r->>'id',r->'data')
    on conflict(store_id,resource,external_id) do update set data=excluded.data,updated_at=now()
    where j.resource<>'orders_history' or not(fulfillment_private.ebay_records.data ? 'lastModifiedDate') or coalesce(excluded.data->>'lastModifiedDate','')>=fulfillment_private.ebay_records.data->>'lastModifiedDate';
  end if;
  end loop;
  if j.resource='listings' and payload ? 'snapshot' and (payload->>'done')::boolean then
   if exists(select 1 from jsonb_each_text(payload#>'{snapshot,totals}') t where t.value::bigint<>(select count(*) from fulfillment_private.ebay_listing_stage st where st.store_id=target and st.scan_id=payload#>>'{snapshot,id}' and st.data->>'syncCategory'=t.key)) then raise exception 'Listing snapshot count mismatch';end if;
   insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) select store_id,'listings',external_id,data from fulfillment_private.ebay_listing_stage where store_id=target and scan_id=payload#>>'{snapshot,id}' on conflict(store_id,resource,external_id) do update set data=excluded.data,updated_at=now();
   delete from fulfillment_private.ebay_listing_stage where store_id=target;
  end if;
  if j.resource='listings' and payload ? 'reconcile_active_before' then
   update fulfillment_private.ebay_records set data=data||'{"catalog_present":false}'::jsonb where store_id=target and resource='listings' and data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}'='ACTIVE' and updated_at<(payload->>'reconcile_active_before')::timestamptz;
  end if;
  -- Never acknowledge an event until a fresh provider record has actually been saved.
  update fulfillment_private.ebay_notification_inbox e set processed_at=now(),disposition='processed'
  where e.store_id=target and e.resource=j.resource and e.processed_at is null and e.disposition='pending'
  and e.received_at<=(ebay_sync_worker.payload->>'watermark')::timestamptz
  and exists(select 1 from fulfillment_private.ebay_records mirror where mirror.store_id=target and mirror.resource=j.resource and mirror.external_id=e.entity_id and mirror.updated_at>=e.received_at);
  update fulfillment_private.ebay_sync_jobs set cursor=coalesce(payload->'cursor','{}'),
   watermark=case when (payload->>'done')::boolean then (payload->>'watermark')::timestamptz else watermark end,
   last_success=case when (payload->>'done')::boolean then now() else last_success end,
   coverage_from=coalesce((payload->>'history_from')::timestamptz,coverage_from),
   last_full_scan=case when (payload->>'done')::boolean and ((j.resource='listings' and payload ? 'snapshot') or (j.resource='transactions' and payload->>'finance_reconcile'='true')) then now() else last_full_scan end,
   available_at=now()+make_interval(secs=>case when not (payload->>'done')::boolean then 0 when resource in ('orders_history','transactions_history') then 315360000 when resource='transactions' then 120 when resource='delivery_tracking' then 60 when resource='orders' and exists(select 1 from fulfillment_private.ebay_notification_subscriptions s where s.store_id=target and s.status='ENABLED' and s.topic=case when j.resource='orders' then 'ORDER_CONFIRMATION' else 'LISTING' end) then 300 when resource='listings' then 1800 when resource='orders' then 120 when resource in ('traffic','listing_traffic') then 43200 else 600 end),
   lease_id=null,lease_until=null,last_error=null,failures=0 where store_id=target and resource=j.resource;
 elsif action='fail' then
  if j.resource='listings' then update fulfillment_private.ebay_sync_jobs set cursor='{}' where store_id=target and resource=j.resource;delete from fulfillment_private.ebay_listing_stage where store_id=target;end if;
  if j.resource in ('traffic','listing_traffic') and payload->>'error' like 'eBay HTTP 429%' then
   update fulfillment_private.ebay_sync_jobs set available_at=now()+interval '24 hours',last_error='eBay analytics quota reached; saved report retained',failures=failures+1,lease_id=null,lease_until=null where store_id=target and resource in ('traffic','listing_traffic');
   return '{}'::jsonb;
  end if;
  update fulfillment_private.ebay_sync_jobs set last_error=left(payload->>'error',160),failures=failures+1,
   available_at=now()+make_interval(secs=>least(21600,greatest(60,coalesce((payload->>'retry_after')::integer,0),60*power(2,least(failures,8))::integer))),
   lease_id=null,lease_until=null where store_id=target and resource=j.resource;
 else raise exception 'Unknown sync operation'; end if;
 return '{}'::jsonb;
end $function$
;
CREATE OR REPLACE FUNCTION public.ebay_workspace_page(target uuid, kind text DEFAULT 'orders'::text, query_text text DEFAULT ''::text, status_filter text DEFAULT ''::text, page_number integer DEFAULT 1, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; n integer:=greatest(1,page_number); size integer:=least(200,greatest(10,page_size));
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
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.external_id,'data',p.data,'updated_at',p.updated_at,'workspace_rows',case when kind='orders' then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'display_number',o.display_number::text,'year',o.year,'month',o.month,'position',o.position,'data',o.data) order by o.year,o.month,o.position) from fulfillment_private.order_rows o where o.store_id=target and o.deleted_at is null and btrim(o.data->>'order_id')=p.external_id),'[]'::jsonb) else '[]'::jsonb end,'image',case when kind='orders' then p.data#>>'{_orderSnapshot,image}' else p.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' end,'supplier',case when kind='listings' then (select jsonb_build_object('asin',sp.asin,'buy_price',sp.buy_price,'updated_at',sp.updated_at) from fulfillment_private.ebay_supplier_products sp where sp.store_id=target and sp.item_id=p.external_id) else null end,'last_sold_at',case when kind='listings' then (select max(o.data->>'creationDate') from fulfillment_private.ebay_records o where o.store_id=target and o.resource='orders' and exists(select 1 from jsonb_array_elements(o.data->'lineItems') li where li->>'legacyItemId'=p.external_id)) else null end,'traffic',case when kind='listings' then (select t.data from fulfillment_private.ebay_records t where t.store_id=target and t.resource='listing_traffic' and t.external_id=p.external_id) else null end) order by p.created desc nulls last,p.external_id desc) from paged p),'[]'),
 'sync',(select jsonb_build_object('last_success',last_success,'error',last_error,'running',coalesce(lease_until>now(),false) or reset_requested or cursor<>'{}'::jsonb,'requested_at',requested_at) from fulfillment_private.ebay_sync_jobs where store_id=target and resource=kind),
 'analytics_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='listing_traffic'),
 'events',jsonb_build_object('enabled',(select count(*)=4 from fulfillment_private.ebay_notification_subscriptions where store_id=target and status='ENABLED' and topic in ('LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY')),'pending',(select count(*) from fulfillment_private.ebay_notification_inbox where store_id=target and disposition='pending'),'last_received',(select max(received_at) from fulfillment_private.ebay_notification_inbox where store_id=target),'last_processed',(select max(processed_at) from fulfillment_private.ebay_notification_inbox where store_id=target)),
 'seller',(select username from fulfillment_private.ebay_connections where store_id=target),'store',(select name from public.stores where id=target)) into result;
 return result;
end $function$
;