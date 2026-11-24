-- Read-only regression for the actual deployed order_rows revision predicate.
-- No records, revision counters, or function definitions are modified.
do $test$
declare
 definition text:=pg_get_functiondef('fulfillment_private.commerce_changed()'::regprocedure);
 branch text;
 data_predicate text;
 active_predicate text;
 revision_predicate text;
 delivery_predicate text;
 refund_predicate text;
 failures text[];
begin
 branch:=(regexp_match(definition,$pattern$elsif TG_TABLE_NAME='order_rows' then([\s\S]*?)\n else$pattern$))[1];
 data_predicate:=(regexp_match(branch,$pattern$meaningful=([^;]+);$pattern$))[1];
 active_predicate:=(regexp_match(branch,$pattern$active_rows_changed=([^;]+);$pattern$))[1];
 revision_predicate:=(regexp_match(definition,$pattern$if ([^\n]+) then\s+insert into fulfillment_private\.commerce_versions$pattern$))[1];
 delivery_predicate:=(regexp_match(branch,$pattern$if ([^\n]+) then perform fulfillment_private\.schedule_delivery$pattern$))[1];
 refund_predicate:=(regexp_match(definition,$pattern$if ([^\n]+) then insert into fulfillment_private\.refund_dirty$pattern$))[1];
 if data_predicate is null or active_predicate is null or revision_predicate is null or delivery_predicate is null or refund_predicate is null then
  raise exception 'Could not find order_rows revision and scheduling predicates';
 end if;
 execute format($query$
  with base as (
   select '{"data":{"order_id":"fixture-order","purchase_id":"buy-1","product_cost":8,"status":"Pending"},"deleted_at":null,"updated_at":"2026-11-01"}'::jsonb as row
  ), fixtures as (
   select scenario.* from base cross join lateral (values
    ('insert',null::jsonb,row,true,true),
    ('unchanged',row,row,false,false),
    ('metadata only',row,jsonb_set(row,'{updated_at}','"2026-11-02"'),false,false),
    ('buying price changed',row,jsonb_set(row,'{data,product_cost}','9'),true,true),
    ('Buy ID cleared',row,jsonb_set(row,'{data,purchase_id}','""'),true,true),
    ('status refunded',row,jsonb_set(row,'{data,status}','"Refunded"'),true,true),
    ('soft delete',row,jsonb_set(row,'{deleted_at}','"2026-11-02"'),true,false),
    ('restore',jsonb_set(row,'{deleted_at}','"2026-11-02"'),row,true,false),
    ('unchanged deleted row',jsonb_set(row,'{deleted_at}','"2026-11-02"'),jsonb_set(row,'{deleted_at}','"2026-11-02"'),false,false)
   ) as scenario(name,prior,v,expected_revision,expected_work)
  ), flags as (
   select *,btrim(v#>>'{data,order_id}') as oid,(%s) as meaningful,(%s) as active_rows_changed from fixtures
  ), results as (
   select *,(%s) as actual_revision,(%s) as actual_delivery,(%s) as actual_refund from flags
  )
  select array_agg(name) filter(where actual_revision is distinct from expected_revision
   or actual_delivery is distinct from expected_work or actual_refund is distinct from expected_work)
  from results
 $query$,data_predicate,active_predicate,revision_predicate,delivery_predicate,refund_predicate) into failures;
 if cardinality(failures)>0 then raise exception 'Commerce revision regression: %',failures;end if;
end $test$;
