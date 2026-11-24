-- Gross revenue / product cost regression for ebay_orders_period_page.
-- Run after installing supabase/ebay-orders-metrics.sql.
-- Uses only synthetic JSON fixtures and pg_get_functiondef; no customer rows,
-- table writes, schema changes, grants, or calls under an impersonated user.
-- The production metric CTEs are extracted at runtime, so these assertions
-- exercise the deployed calculation rather than a copied implementation.
-- Baseline CTEs below are preserved from 0554f59bacf0f964a8528c808e5af667cc061181.
-- Cases cover monthly, yearly and empty periods, edit clearing, actual refunds,
-- cancellation, Due Refund, missing/zero/negative earnings, active-row matching,
-- shared workspace rows, currency gating, and unchanged existing amount/profit fields.
-- Known earnings also become processed when any effective cost is recorded,
-- including explicit zero; missing shipping/additional defaults are not entries.

do $regression$
declare
 definition text := pg_get_functiondef('public.ebay_orders_period_page(uuid,text,text,text,integer,integer,integer,integer)'::regprocedure);
 metric_sql text;
 start_at integer;
 stop_at integer;
 report_month integer;
 result jsonb;
 fixture_sql text := $fixtures$
with fixture_orders as (
 select * from jsonb_to_recordset($orders$[
{"id":"positive_with_id","created":"2026-01-01T12:00:00Z","earning":100.25,"currency":"USD","edit":{"purchase_id":"B-1","buy_price":"20","shipping_cost":"2","additional_cost":"3"},"api":{"creationDate":"2026-01-01T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":true,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":20,"expected_shipping":2,"expected_additional":3,"expected_recorded_cost":true},
{"id":"positive_without_id","created":"2026-01-01T12:00:00Z","earning":15.5,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-01T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"zero_without_id","created":"2026-01-02T12:00:00Z","earning":0,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-02T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"negative_without_id","created":"2026-11-02T12:00:00Z","earning":-5.45,"currency":"USD","edit":{},"api":{"creationDate":"2026-11-02T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"awaiting_without_id","created":"2026-01-03T12:00:00Z","earning":null,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-03T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":1,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"awaiting_with_id","created":"2026-11-03T12:00:00Z","earning":null,"currency":"USD","edit":{"purchase_id":"B-2"},"api":{"creationDate":"2026-11-03T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":true,"expected_status":null,"expected_processed":false,"expected_pending_earnings":1,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"refunded_without_id","created":"2026-01-04T12:00:00Z","earning":12.34,"currency":"USD","edit":{},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-01-04T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"refunded_with_id","created":"2026-11-04T12:00:00Z","earning":-1.25,"currency":"USD","edit":{"purchase_id":"B-3"},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-11-04T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":true,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"cancelled_awaiting","created":"2026-01-05T12:00:00Z","earning":null,"currency":"USD","edit":{},"api":{"cancelStatus":{"cancelState":"CANCELED"},"creationDate":"2026-01-05T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":"Cancelled","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"cancelled_positive","created":"2026-11-05T12:00:00Z","earning":6.11,"currency":"USD","edit":{},"api":{"cancelStatus":{"cancelState":"CANCELED"},"creationDate":"2026-11-05T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":"Cancelled","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"due_refund_without_id","created":"2026-01-06T12:00:00Z","earning":5.67,"currency":"USD","edit":{"status":"Due Refund"},"api":{"creationDate":"2026-01-06T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"due_refund_awaiting","created":"2026-11-06T12:00:00Z","earning":null,"currency":"USD","edit":{"status":"Due Refund"},"api":{"creationDate":"2026-11-06T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":1,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"manual_refunded_without_id","created":"2026-01-07T12:00:00Z","earning":3.33,"currency":"USD","edit":{"status":"Refunded"},"api":{"creationDate":"2026-01-07T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"alert_overrides_api_refund","created":"2026-11-07T12:00:00Z","earning":7.77,"currency":"USD","edit":{"status":"Alert"},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-11-07T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":"Alert","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"oos_overrides_api_refund","created":"2026-01-08T12:00:00Z","earning":8.88,"currency":"USD","edit":{"status":"OOS"},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-01-08T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":"OOS","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"alert_cannot_reactivate_cancelled","created":"2026-11-08T12:00:00Z","earning":null,"currency":"USD","edit":{"status":"Alert"},"api":{"cancelStatus":{"cancelState":"CANCELED"},"creationDate":"2026-11-08T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":"Alert","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"workspace_multirow_cost","created":"2026-01-09T12:00:00Z","earning":20,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-09T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":true,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":10,"expected_shipping":1.5,"expected_additional":2.25,"expected_recorded_cost":true},
{"id":"explicit_empty_id_override","created":"2026-11-09T12:00:00Z","earning":25,"currency":"USD","edit":{"purchase_id":""},"api":{"creationDate":"2026-11-09T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":5,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"explicit_null_id_override","created":"2026-01-10T12:00:00Z","earning":11,"currency":"USD","edit":{"purchase_id":null},"api":{"creationDate":"2026-01-10T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"deleted_workspace_ignored","created":"2026-11-10T12:00:00Z","earning":19,"currency":"USD","edit":{},"api":{"creationDate":"2026-11-10T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"workspace_refunded_without_id","created":"2026-01-11T12:00:00Z","earning":2,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-11T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"explicit_empty_status_override","created":"2026-11-11T12:00:00Z","earning":2,"currency":"USD","edit":{"status":""},"api":{"creationDate":"2026-11-11T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"first_workspace_status_wins","created":"2026-01-12T12:00:00Z","earning":2,"currency":"USD","edit":{},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-01-12T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":"OOS","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"other_store_workspace_ignored","created":"2026-11-12T12:00:00Z","earning":9,"currency":"USD","edit":{},"api":{"creationDate":"2026-11-12T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"non_usd_remains_unavailable","created":"2026-01-13T12:00:00Z","earning":9,"currency":"EUR","edit":{"purchase_id":"B-9","buy_price":"2"},"api":{"creationDate":"2026-01-13T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":true,"expected_status":null,"expected_processed":false,"expected_pending_earnings":1,"expected_pending_cost":0,"expected_cost":2,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"zero_buy_price_is_present","created":"2026-11-13T12:00:00Z","earning":3,"currency":"USD","edit":{"buy_price":"0"},"api":{"creationDate":"2026-11-13T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":0,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"explicit_cost_clear","created":"2026-01-14T12:00:00Z","earning":10,"currency":"USD","edit":{"buy_price":"","shipping_cost":"","additional_cost":""},"api":{"creationDate":"2026-01-14T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"whitespace_edit_id","created":"2026-11-14T12:00:00Z","earning":10,"currency":"USD","edit":{"purchase_id":" \n\t "},"api":{"creationDate":"2026-11-14T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"whitespace_workspace_id","created":"2026-01-15T12:00:00Z","earning":9,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-15T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"cancelled_cost_is_still_actual","created":"2026-11-15T12:00:00Z","earning":20,"currency":"USD","edit":{"buy_price":"8","shipping_cost":"1","additional_cost":"1"},"api":{"cancelStatus":{"cancelState":"CANCELED"},"creationDate":"2026-11-15T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":"Cancelled","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":8,"expected_shipping":1,"expected_additional":1,"expected_recorded_cost":true},
{"id":"refunded_workspace_id","created":"2026-01-16T12:00:00Z","earning":4,"currency":"USD","edit":{},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-01-16T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":true,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"explicit_null_status_override","created":"2026-11-16T12:00:00Z","earning":2,"currency":"USD","edit":{"status":null},"api":{"creationDate":"2026-11-16T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"api_refund_overrides_due_refund","created":"2026-01-17T12:00:00Z","earning":1.23,"currency":"USD","edit":{"status":"Due Refund"},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-01-17T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":false,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"cancelled_with_zero_cost","created":"2026-11-17T12:00:00Z","earning":null,"currency":"USD","edit":{"buy_price":"0"},"api":{"cancelStatus":{"cancelState":"CANCELED"},"creationDate":"2026-11-17T12:00:00Z","pricingSummary":{"total":{"value":"8"}}},"expected_buy_id":false,"expected_status":"Cancelled","expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":0,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"edit_cost_overrides_workspace","created":"2026-01-18T12:00:00Z","earning":10,"currency":"USD","edit":{"buy_price":"7","shipping_cost":"1.5","additional_cost":"0.5"},"api":{"creationDate":"2026-01-18T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":7,"expected_shipping":1.5,"expected_additional":0.5,"expected_recorded_cost":true},
{"id":"refunded_zero_earning_awaiting_cost","created":"2026-11-18T12:00:00Z","earning":0,"currency":"USD","edit":{"purchase_id":"B-12"},"api":{"orderPaymentStatus":"FULLY_REFUNDED","creationDate":"2026-11-18T12:00:00Z","pricingSummary":{"total":{"value":"35"}}},"expected_buy_id":true,"expected_status":"Refunded","expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"buy_price_only_without_id","created":"2026-01-20T12:00:00Z","earning":12,"currency":"USD","edit":{"buy_price":"4"},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":0,"expected_cost":4,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"shipping_only_without_id","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{"shipping_cost":"2.5"},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":2.5,"expected_additional":0,"expected_recorded_cost":true},
{"id":"additional_only_without_id","created":"2026-01-20T12:00:00Z","earning":12,"currency":"USD","edit":{"additional_cost":"1.75"},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":1.75,"expected_recorded_cost":true},
{"id":"zero_shipping_is_recorded","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{"shipping_cost":"0"},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"zero_additional_is_recorded","created":"2026-01-20T12:00:00Z","earning":12,"currency":"USD","edit":{"additional_cost":"0"},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"null_costs_override_workspace","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{"buy_price":null,"shipping_cost":null,"additional_cost":null},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":false},
{"id":"workspace_shipping_only","created":"2026-01-20T12:00:00Z","earning":12,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":3,"expected_additional":0,"expected_recorded_cost":true},
{"id":"workspace_additional_only","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":2,"expected_recorded_cost":true},
{"id":"awaiting_earnings_with_recorded_cost","created":"2026-01-20T12:00:00Z","earning":null,"currency":"USD","edit":{"buy_price":"5"},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":false,"expected_pending_earnings":1,"expected_pending_cost":0,"expected_cost":5,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"due_refund_with_recorded_cost","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{"status":"Due Refund","shipping_cost":"2"},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":2,"expected_additional":0,"expected_recorded_cost":true},
{"id":"workspace_costs_net_zero","created":"2026-01-20T12:00:00Z","earning":12,"currency":"USD","edit":{},"api":{"creationDate":"2026-01-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":0,"expected_recorded_cost":true},
{"id":"partial_clear_preserves_other_cost","created":"2026-11-20T12:00:00Z","earning":12,"currency":"USD","edit":{"shipping_cost":null},"api":{"creationDate":"2026-11-20T12:00:00Z","pricingSummary":{"total":{"value":"22"}}},"expected_buy_id":false,"expected_status":null,"expected_processed":true,"expected_pending_earnings":0,"expected_pending_cost":1,"expected_cost":null,"expected_shipping":0,"expected_additional":2,"expected_recorded_cost":true}
]$orders$::jsonb) as f(
 id text, created text, earning numeric, currency text, edit jsonb, api jsonb,
 expected_buy_id boolean, expected_status text, expected_processed boolean, expected_recorded_cost boolean,
 expected_pending_earnings integer, expected_pending_cost integer,
 expected_cost numeric, expected_shipping numeric, expected_additional numeric)
), fixture_workspace as (
 select * from jsonb_to_recordset($workspace$[
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":1,"deleted_at":null,"data":{"order_id":"workspace_multirow_cost","purchase_id":"B-4","product_cost":"4","shipping_cost":"1","additional_cost":"2"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":2,"deleted_at":null,"data":{"order_id":"workspace_multirow_cost","product_cost":"6","shipping_cost":"0.5","additional_cost":"0.25"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":3,"deleted_at":null,"data":{"order_id":"explicit_empty_id_override","purchase_id":"B-5","product_cost":"5"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":4,"deleted_at":null,"data":{"order_id":"explicit_null_id_override","purchase_id":"B-6"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":5,"deleted_at":"2026-01-01T00:00:00Z","data":{"order_id":"deleted_workspace_ignored","purchase_id":"B-7","product_cost":"99","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":6,"deleted_at":null,"data":{"order_id":"workspace_refunded_without_id","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":7,"deleted_at":null,"data":{"order_id":"explicit_empty_status_override","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":2,"position":1,"deleted_at":null,"data":{"order_id":"first_workspace_status_wins","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":1,"deleted_at":null,"data":{"order_id":"first_workspace_status_wins","status":"OOS"}},
{"store_id":"00000000-0000-0000-0000-000000000002","year":2026,"month":1,"position":10,"deleted_at":null,"data":{"order_id":"other_store_workspace_ignored","purchase_id":"B-8","product_cost":"99","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":11,"deleted_at":null,"data":{"order_id":"explicit_cost_clear","product_cost":"10","shipping_cost":"2","additional_cost":"3"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":12,"deleted_at":null,"data":{"order_id":"whitespace_edit_id","purchase_id":"B-10"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":13,"deleted_at":null,"data":{"order_id":"whitespace_workspace_id","purchase_id":" \n\t "}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":14,"deleted_at":null,"data":{"order_id":"refunded_workspace_id","purchase_id":"B-11"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":15,"deleted_at":null,"data":{"order_id":"explicit_null_status_override","status":"Refunded"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":16,"deleted_at":null,"data":{"order_id":"edit_cost_overrides_workspace","product_cost":"100","shipping_cost":"100","additional_cost":"100"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":17,"deleted_at":null,"data":{"order_id":"null_costs_override_workspace","product_cost":"9","shipping_cost":"2","additional_cost":"1"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":18,"deleted_at":null,"data":{"order_id":"workspace_shipping_only","shipping_cost":"3"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":19,"deleted_at":null,"data":{"order_id":"workspace_additional_only","additional_cost":"2"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":20,"deleted_at":null,"data":{"order_id":"workspace_costs_net_zero","shipping_cost":"3"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":21,"deleted_at":null,"data":{"order_id":"workspace_costs_net_zero","shipping_cost":"-3"}},
{"store_id":"00000000-0000-0000-0000-000000000001","year":2026,"month":1,"position":22,"deleted_at":null,"data":{"order_id":"partial_clear_preserves_other_cost","shipping_cost":"3","additional_cost":"2"}}
]$workspace$::jsonb) as w(
 store_id uuid, year integer, month integer, position bigint, deleted_at timestamptz, data jsonb)
), selected_fixtures as (
 select * from fixture_orders
 where __PERIOD_MONTH__=0 or extract(month from created::timestamptz at time zone 'America/Los_Angeles')=__PERIOD_MONTH__
), records as (
 select id external_id, created, api data from selected_fixtures
), financials as (
 select id external_id, earning, currency from selected_fixtures
), fixture_edits as (
 select '00000000-0000-0000-0000-000000000001'::uuid store_id, id order_id, edit data from fixture_orders
), 
$fixtures$;
 baseline_sql text := $baseline$
baseline_workspace_costs as (
 select btrim(o.data->>'order_id') order_id,
 sum(case when o.data->>'product_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'product_cost')::numeric end) cost,
 sum(case when o.data->>'shipping_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'shipping_cost')::numeric end) shipping,
 sum(case when o.data->>'additional_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'additional_cost')::numeric end) additional
 from fixture_workspace o join records r on btrim(o.data->>'order_id')=r.external_id
 where o.store_id='00000000-0000-0000-0000-000000000001'::uuid and o.deleted_at is null group by 1
 ), baseline_order_amounts as (
 select r.external_id,((r.created)::timestamptz at time zone 'America/Los_Angeles')::date metric_date,
 case when f.currency='USD' then f.earning end earning,
 case when e.data ? 'buy_price' then nullif(e.data->>'buy_price','')::numeric else w.cost end cost,
 coalesce(case when e.data ? 'shipping_cost' then nullif(e.data->>'shipping_cost','')::numeric else w.shipping end,0) shipping,
 coalesce(case when e.data ? 'additional_cost' then nullif(e.data->>'additional_cost','')::numeric else w.additional end,0) additional,
 case when coalesce((r.data#>>'{pricingSummary,total,value}')::numeric,0)<12 then 0 when (r.data#>>'{pricingSummary,total,value}')::numeric<30 then 1 else 2 end size_group
 from records r join financials f on f.external_id=r.external_id
 left join baseline_workspace_costs w on w.order_id=r.external_id
 left join fixture_edits e on e.store_id='00000000-0000-0000-0000-000000000001'::uuid and e.order_id=r.external_id
 ), baseline_order_metrics as (
 select *,round(earning*100) revenue_cents,round(cost*100) cost_cents,
 round((earning-cost-shipping-additional)*100) profit_cents from baseline_order_amounts
 ), baseline_metric_days as (
 select metric_date,count(*) count,coalesce(sum(revenue_cents),0) revenue,coalesce(sum(cost_cents),0) cost,
 coalesce(sum(round(shipping*100)),0) shipping,coalesce(sum(round(additional*100)),0) additional,
 coalesce(sum(profit_cents),0) gross,count(*) filter(where earning is null) pending_earnings,
 count(*) filter(where cost is null) pending_cost,
 count(*) filter(where profit_cents is not null) profit_count,
 count(*) filter(where profit_cents is not null and earning<>0) margin_count,
 coalesce(sum(greatest(-100,least(100,profit_cents/nullif(earning,0)))) filter(where profit_cents is not null and earning<>0),0) margin_sum
 from baseline_order_metrics group by metric_date
 )
$baseline$;
 assertions_sql text := $assertions$
,
expected_days as (
 select (created::timestamptz at time zone 'America/Los_Angeles')::date metric_date,
 count(*) expected_count,
 coalesce(sum(round(earning*100)) filter(where currency='USD'),0) expected_revenue,
 coalesce(sum(round(earning*100)) filter(where currency='USD' and expected_processed),0) expected_processed_revenue,
 coalesce(sum(round(earning*100)) filter(where currency='USD' and not expected_processed),0) expected_unprocessed_revenue,
 sum(expected_pending_earnings) expected_pending_earnings,
 sum(expected_pending_cost) expected_pending_cost
 from selected_fixtures group by 1
), failures as (
 select 'classification_or_cost' test, f.id fixture
 from selected_fixtures f left join order_metrics m on m.external_id=f.id
 where m.external_id is null
 or m.has_buy_id is distinct from f.expected_buy_id
 or m.has_recorded_cost is distinct from f.expected_recorded_cost
 or m.metric_status is distinct from f.expected_status
 or m.is_processed is distinct from f.expected_processed
 or m.earning is distinct from case when f.currency='USD' then f.earning end
 or m.cost is distinct from f.expected_cost
 or m.shipping is distinct from f.expected_shipping
 or m.additional is distinct from f.expected_additional
 union all
 select 'daily_partition_or_pending',e.metric_date::text
 from expected_days e full join metric_days m using(metric_date)
 where m.count is distinct from e.expected_count
 or m.revenue is distinct from e.expected_revenue
 or m.processed_revenue is distinct from e.expected_processed_revenue
 or m.unprocessed_revenue is distinct from e.expected_unprocessed_revenue
 or m.pending_earnings is distinct from e.expected_pending_earnings
 or m.pending_cost is distinct from e.expected_pending_cost
 or m.revenue is distinct from m.processed_revenue+m.unprocessed_revenue
 union all
 select 'unchanged_daily_metrics',coalesce(m.metric_date,b.metric_date)::text
 from metric_days m full join baseline_metric_days b using(metric_date)
 where (to_jsonb(m)-array['processed_revenue','unprocessed_revenue','pending_earnings','pending_cost'])
 is distinct from (to_jsonb(b)-array['pending_earnings','pending_cost'])
 union all
 select 'unchanged_order_amounts',coalesce(m.external_id,b.external_id)
 from order_metrics m full join baseline_order_metrics b using(external_id)
 where (to_jsonb(m)-array['has_buy_id','has_recorded_cost','manual_status','payment_status','cancelled','metric_status','is_processed'])
 is distinct from to_jsonb(b)
 union all
 select 'unchanged_size_metrics',coalesce(m.size_group,b.size_group)::text
 from (select size_group,count(*) c,coalesce(sum(profit_cents),0) profit from order_metrics group by 1) m
 full join (select size_group,count(*) c,coalesce(sum(profit_cents),0) profit from baseline_order_metrics group by 1) b using(size_group)
 where row(m.c,m.profit) is distinct from row(b.c,b.profit)
)
select jsonb_build_object(
 'period_month',__PERIOD_MONTH__,
 'case_count',(select count(*) from selected_fixtures),
 'revenue',(select coalesce(sum(revenue),0) from metric_days),
 'processed_revenue',(select coalesce(sum(processed_revenue),0) from metric_days),
 'unprocessed_revenue',(select coalesce(sum(unprocessed_revenue),0) from metric_days),
 'pending_earnings',(select coalesce(sum(pending_earnings),0) from metric_days),
 'pending_cost',(select coalesce(sum(pending_cost),0) from metric_days),
 'failures',(select coalesce(jsonb_agg(to_jsonb(f) order by test,fixture),'[]'::jsonb) from failures f)
) result
$assertions$;
begin
 start_at := strpos(definition,'workspace_costs as (');
 stop_at := strpos(definition,'), filtered as (');
 if start_at=0 or stop_at<=start_at then
  raise exception 'Metric CTE boundaries changed; update this regression extractor.';
 end if;
 metric_sql := substring(definition from start_at for stop_at-start_at)||')';
 metric_sql := replace(metric_sql,'fulfillment_private.order_rows','fixture_workspace');
 metric_sql := replace(metric_sql,'fulfillment_private.ebay_order_edits','fixture_edits');
 metric_sql := regexp_replace(metric_sql,'\mtarget\M',quote_literal('00000000-0000-0000-0000-000000000001')||'::uuid','g');
 metric_sql := replace(metric_sql,'at time zone zone','at time zone '||quote_literal('America/Los_Angeles'));
 foreach report_month in array array[0,1,11,2] loop
  execute replace(fixture_sql||metric_sql||', '||baseline_sql||assertions_sql,'__PERIOD_MONTH__',report_month::text) into result;
  if jsonb_array_length(result->'failures')<>0 then
   raise exception 'Order overview regression failed for month %: %',report_month,result;
  end if;
  if (result->>'revenue')::numeric<>(result->>'processed_revenue')::numeric+(result->>'unprocessed_revenue')::numeric then
   raise exception 'Revenue split does not reconcile for month %: %',report_month,result;
  end if;
  if (result->>'case_count')::integer<>(case report_month when 0 then 48 when 1 then 25 when 11 then 23 else 0 end) then
   raise exception 'Fixture period selection changed: %',result;
  end if;
  raise notice 'Order overview regression passed: %',result;
 end loop;
end $regression$;
