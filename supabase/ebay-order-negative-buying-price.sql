-- Allow a signed base Buying Price; preserve Shipping and Additional Cost rules.
-- Full current save definition retains existing field support, store access and revision checks.
CREATE OR REPLACE FUNCTION public.ebay_order_edit_save(target uuid, order_id text, changes jsonb, expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; k text; v jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if not exists(select 1 from fulfillment_private.ebay_records r where r.store_id=target and r.resource='orders' and r.external_id=order_id) then raise exception 'Order not found'; end if;
 if jsonb_typeof(changes)<>'object' or octet_length(changes::text)>16000 then raise exception 'Invalid changes'; end if;
 for k,v in select * from jsonb_each(changes) loop
  if k not in ('status','tags','note','purchase_id','buyer_account','platform','buy_price','shipping_cost','additional_cost','tracking','carrier','supplier','buy_url','first_name','last_name','address1','address2','city','state','zip','country','phone') then raise exception 'Unsupported field'; end if;
  if k in ('buy_price','shipping_cost','additional_cost') then
   if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v::text)::numeric<case when k='buy_price' then -999999999 else 0 end or (v::text)::numeric>999999999 or round((v::text)::numeric,2)<>(v::text)::numeric) then raise exception 'Invalid buying price'; end if;
  elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'Invalid text field'; end if;
 end loop;

 if changes ? 'platform' and (length(changes->>'platform')>60 or
  (changes->>'platform'<>'' and not (
   changes->>'platform'=any(coalesce((select platforms from fulfillment_private.store_options where store_id=target),array['Amazon']))
   or exists(select 1 from fulfillment_private.order_rows o where o.store_id=target and o.deleted_at is null and btrim(o.data->>'order_id')=ebay_order_edit_save.order_id and o.data->>'platform'=changes->>'platform')
   or exists(select 1 from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=ebay_order_edit_save.order_id and e.data->>'platform'=changes->>'platform')
  ))) then raise exception 'Select a configured platform'; end if;
 if changes ? 'supplier' and changes->>'supplier' not in ('Amazon','AliExpress','Alibaba') then raise exception 'Invalid supplier'; end if;
 if changes ? 'buyer_account' and changes->>'buyer_account' not in ('','Amazon','AutoDS') then raise exception 'Invalid buyer account'; end if;
 if changes ? 'status' and changes->>'status' not in ('','Pending','Due Refund','Ordered','Processed','Shipped','Delivered','Cancelled','Refunded','OOS','Alert','Label Created') then raise exception 'Invalid status'; end if;
 if changes ? 'carrier' and changes->>'carrier' not in ('','Amazon','USPS','UPS','DHL','FedEx','Other') then raise exception 'Invalid carrier'; end if;
 if coalesce(changes->>'buy_url','')<>'' and changes->>'buy_url' !~ '^https://([a-zA-Z0-9-]+\.)*(amazon\.com|aliexpress\.com|alibaba\.com)/' then raise exception 'Use a supported supplier product URL'; end if;
 insert into fulfillment_private.ebay_order_edits as e(store_id,order_id,data,updated_by)
 select target,order_id,changes,auth.uid() where expected_revision=0
 on conflict on constraint ebay_order_edits_pkey do nothing;
 if not found then
  update fulfillment_private.ebay_order_edits e set data=e.data||changes,revision=e.revision+1,updated_at=now(),updated_by=auth.uid()
  where e.store_id=target and e.order_id=ebay_order_edit_save.order_id and e.revision=expected_revision;
  if not found then raise exception 'This order changed in another session. Reopen it before saving.'; end if;
 end if;
 select jsonb_build_object('data',e.data,'revision',e.revision) into result from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=ebay_order_edit_save.order_id;
 return result;
end $function$;

