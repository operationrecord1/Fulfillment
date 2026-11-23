-- A payment hold/release moves available funds; it is not an order expense.
-- Keep the raw ledger records. Actual refunds, fees and final debits still count.
create or replace function fulfillment_private.ebay_is_temporary_hold(d jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(d->>'transactionType'='DISPUTE' and d->>'transactionId' ~ '^DISPUTE_(HOLD|RELEASE)-',false);
$$;
revoke all on function fulfillment_private.ebay_is_temporary_hold(jsonb) from public,anon,authenticated;

do $$
declare f record; definition text; previous text := 'and fulfillment_private.ebay_transaction_order_id(t.data)=r.external_id';
begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('ebay_orders_period_page','ebay_workspace_page') loop
  definition=pg_get_functiondef(f.oid);
  if position(previous in definition)>0 and position('ebay_is_temporary_hold(t.data)' in definition)=0 then
   execute replace(definition,previous,previous||' and not fulfillment_private.ebay_is_temporary_hold(t.data)');
  end if;
 end loop;
end $$;

-- Regression: sale 32.37 - ad fee 2.88 = 29.49, irrespective of a 37.99 hold.
do $$
declare result numeric;
begin
 with ledger(d) as (values
 ('{"transactionId":"sale","transactionType":"SALE","bookingEntry":"CREDIT","amount":{"value":"32.37"}}'::jsonb),
 ('{"transactionId":"ad","transactionType":"NON_SALE_CHARGE","bookingEntry":"DEBIT","amount":{"value":"2.88"}}'::jsonb),
 ('{"transactionId":"DISPUTE_HOLD-test","transactionType":"DISPUTE","bookingEntry":"DEBIT","amount":{"value":"37.99"}}'::jsonb)
 ) select sum(case when d->>'bookingEntry'='DEBIT' then -1 else 1 end*(d#>>'{amount,value}')::numeric) into result from ledger where not fulfillment_private.ebay_is_temporary_hold(d);
 if result<>29.49 then raise exception 'Hold regression: %',result; end if;
 if fulfillment_private.ebay_is_temporary_hold('{"transactionId":"refund","transactionType":"REFUND","bookingEntry":"DEBIT"}') then raise exception 'Actual refund excluded'; end if;
 if not fulfillment_private.ebay_is_temporary_hold('{"transactionId":"DISPUTE_RELEASE-test","transactionType":"DISPUTE","bookingEntry":"CREDIT"}') then raise exception 'Release regression'; end if;
 if fulfillment_private.ebay_is_temporary_hold('{"transactionId":"dispute-final","transactionType":"DISPUTE","bookingEntry":"DEBIT"}') then raise exception 'Final debit excluded'; end if;
end $$;
