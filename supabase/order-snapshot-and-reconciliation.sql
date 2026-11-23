-- Freeze the first available order presentation independently of live listings.
create or replace function fulfillment_private.preserve_ebay_order_presentation()
returns trigger language plpgsql set search_path='' as $$
declare snap jsonb; image text; items jsonb;
begin
 if new.resource='transactions' and TG_OP='UPDATE' then
  if new.data=old.data then return null; end if;
 end if;
 if new.resource<>'orders' then return new; end if;
 if TG_OP='UPDATE' then snap=old.data->'_orderSnapshot'; end if;
 if snap is null then
  snap=jsonb_build_object('items',case when TG_OP='UPDATE' then old.data->'lineItems' else new.data->'lineItems' end,'capturedAt',now());
 end if;
 image=nullif(snap->>'image','');
 if image is null then
  select coalesce(nullif(l.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}',''),nullif(l.data#>>'{listing,sellerProduct,images,0,externalImageUrl}','')) into image
  from fulfillment_private.ebay_records l where l.store_id=new.store_id and l.resource='listings' and l.external_id=new.data#>>'{lineItems,0,legacyItemId}';
  if image is not null then snap=snap||jsonb_build_object('image',image); end if;
 end if;
 select jsonb_agg(case when saved.item->>'title' is not null then jsonb_set(x.item,'{title}',saved.item->'title') else x.item end order by x.n) into items
 from jsonb_array_elements(coalesce(new.data->'lineItems','[]')) with ordinality x(item,n)
 left join lateral (select z.item from jsonb_array_elements(coalesce(snap->'items','[]')) with ordinality z(item,n)
 where (x.item->>'lineItemId' is not null and z.item->>'lineItemId'=x.item->>'lineItemId') or (x.item->>'lineItemId' is null and z.n=x.n) limit 1) saved on true;
 new.data=new.data||jsonb_build_object('_orderSnapshot',snap,'lineItems',coalesce(items,'[]'));
 return new;
end $$;
revoke all on function fulfillment_private.preserve_ebay_order_presentation() from public,anon,authenticated;
create trigger preserve_ebay_order_presentation before insert or update on fulfillment_private.ebay_records for each row execute function fulfillment_private.preserve_ebay_order_presentation();

-- If catalog sync arrives after the order, fill its missing image once only.
create or replace function fulfillment_private.fill_ebay_order_image()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.resource='listings' then
  update fulfillment_private.ebay_records set data=data where store_id=new.store_id and resource='orders' and data#>>'{lineItems,0,legacyItemId}'=new.external_id and nullif(data#>>'{_orderSnapshot,image}','') is null;
 end if;
 return new;
end $$;
revoke all on function fulfillment_private.fill_ebay_order_image() from public,anon,authenticated;
create trigger fill_ebay_order_image after insert or update on fulfillment_private.ebay_records for each row when (new.resource='listings') execute function fulfillment_private.fill_ebay_order_image();
update fulfillment_private.ebay_records set data=data where resource='orders';

do $$
declare f record; definition text; previous text := '(select l.data#>>''{listing,sellerProduct,images,0,ebayImageUrl}'' from fulfillment_private.ebay_records l where l.store_id=target and l.resource=''listings'' and l.external_id=p.data#>>''{lineItems,0,legacyItemId}'' limit 1)';
begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('ebay_orders_period_page','ebay_workspace_page') loop
  definition=pg_get_functiondef(f.oid);
  if position(previous in definition)=0 then raise exception 'Expected image expression missing'; end if;
  execute replace(definition,previous,'p.data#>>''{_orderSnapshot,image}''');
 end loop;
 definition=pg_get_functiondef('public.ebay_sync_worker(text,jsonb)'::regprocedure);
 definition=replace(definition,'last_full_scan=case when j.resource=''listings'' and payload ? ''snapshot'' and (payload->>''done'')::boolean then now() else last_full_scan end',
 'last_full_scan=case when (payload->>''done'')::boolean and ((j.resource=''listings'' and payload ? ''snapshot'') or (j.resource=''transactions'' and payload->>''finance_reconcile''=''true'')) then now() else last_full_scan end');
 execute definition;
end $$;
