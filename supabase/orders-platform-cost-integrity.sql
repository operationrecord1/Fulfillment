
-- Temporary fund movements are neither sales nor order expenses.
create or replace function fulfillment_private.ebay_is_temporary_hold(d jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(
  (d->>'transactionType'='DISPUTE' and d->>'transactionId' ~ '^DISPUTE_(HOLD|RELEASE)-')
  or (d->>'transactionType'='CREDIT' and d->>'transactionId' ~ '^DISPUTE_HOLD_REVERSE-'),false);
$$;
revoke all on function fulfillment_private.ebay_is_temporary_hold(jsonb) from public,anon,authenticated;
do $migration$
declare f record; original text; updated text;
begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('ebay_orders_period_page','ebay_workspace_page') loop
  original=pg_get_functiondef(f.oid);
  updated=replace(original,'where o.store_id=target and btrim','where o.store_id=target and o.deleted_at is null and btrim');
  updated=replace(updated,'where o.store_id=target group by 1','where o.store_id=target and o.deleted_at is null group by 1');
  if f.proname='ebay_orders_period_page' then
   updated=replace(updated,'ready as (select r.* from filtered r join financials f on f.external_id=r.external_id where f.earning is not null)','ready as (select r.* from filtered r)');
   updated=replace(updated,'''pending_total'',(select count(*) from filtered)-(select count(*) from ready)','''pending_total'',(select count(*) from filtered r join financials f on f.external_id=r.external_id where f.earning is null)');
   updated=replace(updated,'''order_metrics'',jsonb_build_object','''platform_options'',(select jsonb_build_object(''platforms'',platforms,''platform_colors'',platform_colors,''platform_text_colors'',platform_text_colors) from fulfillment_private.store_options where store_id=target),''order_metrics'',jsonb_build_object');
  end if;
  if updated=original then raise exception 'Expected Orders source patch missing: %',f.proname; end if;
  execute updated;
 end loop;
 original=pg_get_functiondef('public.ebay_order_edit_save(uuid,text,jsonb,integer)'::regprocedure);
 updated=replace(original,'''buyer_account'',''buy_price''','''buyer_account'',''platform'',''buy_price''');
 updated=replace(updated,' if changes ? ''supplier''', $validation$
 if changes ? 'platform' and (length(changes->>'platform')>60 or
  (changes->>'platform'<>'' and not (
   changes->>'platform'=any(coalesce((select platforms from fulfillment_private.store_options where store_id=target),array['Amazon']))
   or exists(select 1 from fulfillment_private.order_rows o where o.store_id=target and o.deleted_at is null and btrim(o.data->>'order_id')=ebay_order_edit_save.order_id and o.data->>'platform'=changes->>'platform')
   or exists(select 1 from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=ebay_order_edit_save.order_id and e.data->>'platform'=changes->>'platform')
  ))) then raise exception 'Select a configured platform'; end if;
 if changes ? 'supplier'$validation$);
 if updated=original then raise exception 'Expected platform save patch missing'; end if;
 execute updated;
end $migration$;

