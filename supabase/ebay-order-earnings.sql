-- Order-level net earnings from the seller's actual Finances ledger.
create or replace function fulfillment_private.ebay_transaction_order_id(d jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(d->>'orderId',''),(select x->>'referenceId' from jsonb_array_elements(coalesce(d->'references','[]')) x where x->>'referenceType'='ORDER_ID' limit 1));
$$;
revoke all on function fulfillment_private.ebay_transaction_order_id(jsonb) from public,anon,authenticated;
create index if not exists ebay_transaction_order on fulfillment_private.ebay_records(store_id,fulfillment_private.ebay_transaction_order_id(data)) where resource='transactions';
alter table fulfillment_private.ebay_sync_jobs drop constraint ebay_sync_jobs_resource_check;
alter table fulfillment_private.ebay_sync_jobs add constraint ebay_sync_jobs_resource_check check(resource in ('orders','listings','returns','transactions','traffic','listing_traffic','orders_history','transactions_history'));
create or replace function public.ebay_sync_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j fulfillment_private.ebay_sync_jobs; c fulfillment_private.ebay_connections; t jsonb; r jsonb; target uuid; token uuid;
begin
 if action='claim' then
  -- Serialize claim selection, including claims for different resources of one seller.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ebay_sync_claim',0));
  update fulfillment_private.ebay_sync_jobs set cursor='{}',watermark=null,reset_requested=false,available_at=now() where reset_requested and coalesce(lease_until,now())<=now();
  insert into fulfillment_private.ebay_sync_jobs(store_id,resource)
  select store_id,k from fulfillment_private.ebay_connections cross join unnest(array['orders','listings','returns','transactions','traffic','listing_traffic','orders_history','transactions_history']) k on conflict do nothing;
  select * into j from fulfillment_private.ebay_sync_jobs a where a.available_at<=now()
   and coalesce(a.lease_until,now())<=now()
   and (a.resource<>'listing_traffic' or exists(select 1 from fulfillment_private.ebay_sync_jobs l where l.store_id=a.store_id and l.resource='listings' and l.last_success is not null))
   and not exists(select 1 from fulfillment_private.ebay_sync_jobs b where b.store_id=a.store_id and b.lease_until>now())
   order by case when a.resource='orders' then 0 when a.resource='listings' then 1 when a.resource in ('orders_history','transactions_history') then 3 else 2 end,a.available_at,a.store_id,a.resource for update skip locked limit 1;
  if not found then return null; end if;
  token=gen_random_uuid();
  update fulfillment_private.ebay_sync_jobs set lease_id=token,lease_until=now()+interval '90 seconds' where store_id=j.store_id and resource=j.resource;
  select * into c from fulfillment_private.ebay_connections where store_id=j.store_id;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  return to_jsonb(j)||jsonb_build_object('lease_id',token,'tokens',t,'access_expires_at',c.access_expires_at,'refresh_expires_at',c.refresh_expires_at,
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
   last_full_scan=case when j.resource='listings' and payload ? 'snapshot' and (payload->>'done')::boolean then now() else last_full_scan end,
   available_at=now()+make_interval(secs=>case when not (payload->>'done')::boolean then 0 when resource in ('orders_history','transactions_history') then 315360000 when resource='transactions' then 120 when resource in ('orders','listings') and exists(select 1 from fulfillment_private.ebay_notification_subscriptions s where s.store_id=target and s.status='ENABLED' and s.topic=case when j.resource='orders' then 'ORDER_CONFIRMATION' else 'LISTING' end) then 300 when resource='orders' then 120 when resource in ('traffic','listing_traffic') then 86400 else 600 end),
   lease_id=null,lease_until=null,last_error=null,failures=0 where store_id=target and resource=j.resource;
 elsif action='fail' then
  if j.resource='listings' and j.watermark is null then update fulfillment_private.ebay_sync_jobs set cursor='{}' where store_id=target and resource=j.resource;delete from fulfillment_private.ebay_listing_stage where store_id=target;end if;
  if j.resource in ('traffic','listing_traffic') and payload->>'error' like 'eBay HTTP 429%' then
   update fulfillment_private.ebay_sync_jobs set available_at=now()+interval '24 hours',last_error='eBay analytics quota reached; saved report retained',failures=failures+1,lease_id=null,lease_until=null where store_id=target and resource in ('traffic','listing_traffic');
   return '{}'::jsonb;
  end if;
  update fulfillment_private.ebay_sync_jobs set last_error=left(payload->>'error',160),failures=failures+1,
   available_at=now()+make_interval(secs=>least(21600,greatest(60,coalesce((payload->>'retry_after')::integer,0),60*power(2,least(failures,8))::integer))),
   lease_id=null,lease_until=null where store_id=target and resource=j.resource;
 else raise exception 'Unknown sync operation'; end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.ebay_sync_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_sync_worker(text,jsonb) to service_role;



create or replace function public.ebay_orders_period_page(target uuid,kind text default 'orders',query_text text default '',status_filter text default '',page_number integer default 1,page_size integer default 25,period_year integer default 2026,period_month integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period_start date; period_end date; elapsed_days integer; zone text; lower_date text; upper_date text; result jsonb; n integer:=greatest(1,page_number); size integer:=least(100,greatest(10,page_size));
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 select reporting_timezone into zone from fulfillment_private.ebay_connections where store_id=target;zone=coalesce(zone,'America/Los_Angeles');
 if kind<>'orders' or period_year not between 2000 and 2100 or period_month not between 0 and 12 then raise exception 'Invalid order period'; end if;
 lower_date=to_char((make_date(period_year,greatest(1,period_month),1)::timestamp at time zone zone) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 upper_date=to_char(((make_date(period_year,greatest(1,period_month),1)+case when period_month=0 then interval '1 year' else interval '1 month' end) at time zone zone) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 period_start=make_date(period_year,greatest(1,period_month),1);
 period_end=(period_start+case when period_month=0 then interval '1 year' else interval '1 month' end)::date;
 elapsed_days=greatest(0,least(period_end,(now() at time zone zone)::date+1)-period_start);
 with records as (
  select r.external_id,r.data,r.updated_at,
   case when kind='listings' then case when r.data->>'catalog_present'='false' then 'UNAVAILABLE' else r.data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}' end else case when r.data#>>'{cancelStatus,cancelState}'='CANCELED' then 'CANCELLED' else r.data->>'orderFulfillmentStatus' end end as state,
   case when kind='listings' then r.data#>>'{listing,sellerProduct,title}' else (select string_agg(x->>'title',' ') from jsonb_array_elements(r.data->'lineItems') x) end as title,
   case when kind='orders' then r.data->>'creationDate' else r.data#>>'{listing,listingTerms,lifecycleTerms,startAt}' end as created
  from fulfillment_private.ebay_records r where r.store_id=target and r.resource=kind and r.data->>'creationDate'>=lower_date and r.data->>'creationDate'<upper_date
 ), financials as (
 select r.external_id,
 case when count(*) filter(where t.data->>'transactionType'='SALE')>0
 and count(distinct t.data#>>'{amount,currency}')=1
 and bool_and(t.data->>'bookingEntry' in ('CREDIT','DEBIT') and coalesce(t.data#>>'{amount,value}','') ~ '^-?[0-9]+([.][0-9]+)?$' and t.data->>'transactionType' in ('SALE','REFUND','CREDIT','DISPUTE','NON_SALE_CHARGE','SHIPPING_LABEL','ADJUSTMENT'))
 then sum(case when t.data->>'bookingEntry'='DEBIT' then -1 else 1 end * case when coalesce(t.data#>>'{amount,value}','') ~ '^-?[0-9]+([.][0-9]+)?$' then (t.data#>>'{amount,value}')::numeric end) end as earning,
 min(t.data#>>'{amount,currency}') currency,max(t.updated_at) updated_at
 from records r left join fulfillment_private.ebay_records t on t.store_id=target and t.resource='transactions' and fulfillment_private.ebay_transaction_order_id(t.data)=r.external_id
 group by r.external_id
 ), filtered as (select * from records where (status_filter='' or state=status_filter) and (query_text='' or external_id ilike '%'||left(query_text,160)||'%' or title ilike '%'||left(query_text,160)||'%' or data->'buyer'->>'username' ilike '%'||left(query_text,160)||'%')),
 paged as (select * from filtered order by created desc nulls last,external_id desc limit size offset (n-1)*size)
 select jsonb_build_object('timezone',zone,'imported_total',(select count(*) from fulfillment_private.ebay_records where store_id=target and resource='orders'),'period_count',(select count(*) from records),'size_counts',jsonb_build_array((select count(*) from records where coalesce((data#>>'{pricingSummary,total,value}')::numeric,0)<12),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=12 and (data#>>'{pricingSummary,total,value}')::numeric<30),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=30)),'history',(select jsonb_build_object('complete',last_success is not null,'error',last_error,'from',coverage_from) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='orders_history'),'total',(select count(*) from filtered),'counts',(select coalesce(jsonb_object_agg(state,c),'{}') from (select coalesce(state,'UNKNOWN') state,count(*) c from records group by 1) c),
 'average_daily_orders',case when elapsed_days>0 then (select count(*)::numeric/elapsed_days from records) else 0 end,
 'elapsed_days',elapsed_days,
 'daily_counts',(select coalesce(jsonb_object_agg(order_day,c),'{}') from (select ((data->>'creationDate')::timestamptz at time zone zone)::date as order_day,count(*) c from records group by 1) daily),
 'earnings_summary',(select jsonb_build_object('ready_count',count(earning),'pending_count',count(*)-count(earning),'currency',min(currency),'average',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(avg(earning),0) end,'total',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(sum(earning),0) end) from financials),
 'finance_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='transactions'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.external_id,'data',p.data,'earnings',(select jsonb_build_object('value',f.earning,'currency',f.currency,'updated_at',f.updated_at) from financials f where f.external_id=p.external_id),'updated_at',p.updated_at,'workspace_rows',case when kind='orders' then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'display_number',o.display_number::text,'year',o.year,'month',o.month,'position',o.position,'data',o.data) order by o.year,o.month,o.position) from fulfillment_private.order_rows o where o.store_id=target and btrim(o.data->>'order_id')=p.external_id),'[]'::jsonb) else '[]'::jsonb end,'image',case when kind='orders' then (select l.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' from fulfillment_private.ebay_records l where l.store_id=target and l.resource='listings' and l.external_id=p.data#>>'{lineItems,0,legacyItemId}' limit 1) else p.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' end,'traffic',case when kind='listings' then (select t.data from fulfillment_private.ebay_records t where t.store_id=target and t.resource='listing_traffic' and t.external_id=p.external_id) else null end) order by p.created desc nulls last,p.external_id desc) from paged p),'[]'),
 'sync',(select jsonb_build_object('last_success',last_success,'error',last_error,'running',coalesce(lease_until>now(),false) or reset_requested or cursor<>'{}'::jsonb,'requested_at',requested_at) from fulfillment_private.ebay_sync_jobs where store_id=target and resource=kind),
 'analytics_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='listing_traffic'),
 'events',jsonb_build_object('enabled',(select count(*)=4 from fulfillment_private.ebay_notification_subscriptions where store_id=target and status='ENABLED' and topic in ('LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY')),'pending',(select count(*) from fulfillment_private.ebay_notification_inbox where store_id=target and disposition='pending'),'last_received',(select max(received_at) from fulfillment_private.ebay_notification_inbox where store_id=target),'last_processed',(select max(processed_at) from fulfillment_private.ebay_notification_inbox where store_id=target)),
 'seller',(select username from fulfillment_private.ebay_connections where store_id=target),'store',(select name from public.stores where id=target)) into result;
 return result;
end $$;
revoke all on function public.ebay_orders_period_page(uuid,text,text,text,integer,integer,integer,integer) from public,anon;
grant execute on function public.ebay_orders_period_page(uuid,text,text,text,integer,integer,integer,integer) to authenticated;



insert into fulfillment_private.ebay_sync_jobs(store_id,resource) select store_id,'transactions_history' from fulfillment_private.ebay_connections on conflict do nothing;
update fulfillment_private.ebay_sync_jobs set available_at=least(available_at,now()) where resource='transactions';
