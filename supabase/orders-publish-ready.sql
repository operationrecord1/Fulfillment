CREATE OR REPLACE FUNCTION public.ebay_orders_period_page(target uuid, kind text DEFAULT 'orders'::text, query_text text DEFAULT ''::text, status_filter text DEFAULT ''::text, page_number integer DEFAULT 1, page_size integer DEFAULT 25, period_year integer DEFAULT 2026, period_month integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 ready as (select r.* from filtered r join financials f on f.external_id=r.external_id where f.earning is not null),
 paged as (select * from ready order by created desc nulls last,external_id desc limit size offset (n-1)*size)
 select jsonb_build_object('timezone',zone,'imported_total',(select count(*) from fulfillment_private.ebay_records where store_id=target and resource='orders'),'period_count',(select count(*) from records),'size_counts',jsonb_build_array((select count(*) from records where coalesce((data#>>'{pricingSummary,total,value}')::numeric,0)<12),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=12 and (data#>>'{pricingSummary,total,value}')::numeric<30),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=30)),'history',(select jsonb_build_object('complete',last_success is not null,'error',last_error,'from',coverage_from) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='orders_history'),'total',(select count(*) from ready),'pending_total',(select count(*) from filtered)-(select count(*) from ready),'counts',(select coalesce(jsonb_object_agg(state,c),'{}') from (select coalesce(state,'UNKNOWN') state,count(*) c from records group by 1) c),
 'average_daily_orders',case when elapsed_days>0 then (select count(*)::numeric/elapsed_days from records) else 0 end,
 'elapsed_days',elapsed_days,
 'daily_counts',(select coalesce(jsonb_object_agg(order_day,c),'{}') from (select ((data->>'creationDate')::timestamptz at time zone zone)::date as order_day,count(*) c from records group by 1) daily),
 'earnings_summary',(select jsonb_build_object('ready_count',count(earning),'pending_count',count(*)-count(earning),'currency',min(currency),'average',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(avg(earning),0) end,'total',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(sum(earning),0) end) from financials),
 'finance_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='transactions'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.external_id,'data',p.data,'edit',(select jsonb_build_object('data',e.data,'revision',e.revision) from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=p.external_id),'earnings',(select jsonb_build_object('value',f.earning,'currency',f.currency,'updated_at',f.updated_at) from financials f where f.external_id=p.external_id),'updated_at',p.updated_at,'workspace_rows',case when kind='orders' then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'display_number',o.display_number::text,'year',o.year,'month',o.month,'position',o.position,'data',o.data) order by o.year,o.month,o.position) from fulfillment_private.order_rows o where o.store_id=target and btrim(o.data->>'order_id')=p.external_id),'[]'::jsonb) else '[]'::jsonb end,'image',case when kind='orders' then (select l.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' from fulfillment_private.ebay_records l where l.store_id=target and l.resource='listings' and l.external_id=p.data#>>'{lineItems,0,legacyItemId}' limit 1) else p.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' end,'traffic',case when kind='listings' then (select t.data from fulfillment_private.ebay_records t where t.store_id=target and t.resource='listing_traffic' and t.external_id=p.external_id) else null end) order by p.created desc nulls last,p.external_id desc) from paged p),'[]'),
 'sync',(select jsonb_build_object('last_success',last_success,'error',last_error,'running',coalesce(lease_until>now(),false) or reset_requested or cursor<>'{}'::jsonb,'requested_at',requested_at) from fulfillment_private.ebay_sync_jobs where store_id=target and resource=kind),
 'analytics_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='listing_traffic'),
 'events',jsonb_build_object('enabled',(select count(*)=4 from fulfillment_private.ebay_notification_subscriptions where store_id=target and status='ENABLED' and topic in ('LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY')),'pending',(select count(*) from fulfillment_private.ebay_notification_inbox where store_id=target and disposition='pending'),'last_received',(select max(received_at) from fulfillment_private.ebay_notification_inbox where store_id=target),'last_processed',(select max(processed_at) from fulfillment_private.ebay_notification_inbox where store_id=target)),
 'seller',(select username from fulfillment_private.ebay_connections where store_id=target),'store',(select name from public.stores where id=target)) into result;
 return result;
end $function$
