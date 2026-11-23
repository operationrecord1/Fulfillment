-- Retain current function bodies and authorization; only increase the bounded page limit.
DO $$
DECLARE r record; source text;
BEGIN
 FOR r IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('ebay_workspace_page','ebay_orders_period_page') LOOP
  source:=pg_get_functiondef(r.oid);
  IF position('least(100,greatest(10,page_size))' in source)=0 THEN RAISE EXCEPTION 'Unexpected pagination definition: %',r.proname; END IF;
  EXECUTE replace(source,'least(100,greatest(10,page_size))','least(200,greatest(10,page_size))');
 END LOOP;
END $$;
