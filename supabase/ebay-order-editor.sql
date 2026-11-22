create table if not exists fulfillment_private.ebay_order_edits (
 store_id uuid not null references public.stores(id) on delete cascade,
 order_id text not null, data jsonb not null default '{}', revision integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid,
 primary key(store_id,order_id)
);
alter table fulfillment_private.ebay_order_edits enable row level security;
revoke all on fulfillment_private.ebay_order_edits from public,anon,authenticated;
create or replace function public.ebay_order_edit_save(target uuid, order_id text, changes jsonb, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; k text; v jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if not exists(select 1 from fulfillment_private.ebay_records r where r.store_id=target and r.resource='orders' and r.external_id=order_id) then raise exception 'Order not found'; end if;
 if jsonb_typeof(changes)<>'object' or octet_length(changes::text)>16000 then raise exception 'Invalid changes'; end if;
 for k,v in select * from jsonb_each(changes) loop
  if k not in ('status','tags','note','purchase_id','buyer_account','buy_price','tracking','carrier','supplier','buy_url','first_name','last_name','address1','address2','city','state','zip','country','phone') then raise exception 'Unsupported field'; end if;
  if k='buy_price' then
   if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v::text)::numeric<0 or (v::text)::numeric>999999999 or round((v::text)::numeric,2)<>(v::text)::numeric) then raise exception 'Invalid buying price'; end if;
  elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'Invalid text field'; end if;
 end loop;
 if changes ? 'supplier' and changes->>'supplier' not in ('Amazon','AliExpress','Alibaba') then raise exception 'Invalid supplier'; end if;
 if changes ? 'buyer_account' and changes->>'buyer_account' not in ('','Amazon','AutoDS') then raise exception 'Invalid buyer account'; end if;
 if changes ? 'status' and changes->>'status' not in ('','Pending','Ordered','Processed','Shipped','Delivered','Cancelled','Refunded','Alert','Label Created') then raise exception 'Invalid status'; end if;
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
end $$;
revoke all on function public.ebay_order_edit_save(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.ebay_order_edit_save(uuid,text,jsonb,integer) to authenticated;
do $$ declare definition text; begin
 select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='ebay_orders_period_page';
 if position('ebay_order_edits' in definition)=0 then
 definition=replace(definition,'''data'',p.data,''earnings''','''data'',p.data,''edit'',(select jsonb_build_object(''data'',e.data,''revision'',e.revision) from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=p.external_id),''earnings''');
 execute definition;
 end if;
end $$;
