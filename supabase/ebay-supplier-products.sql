create table if not exists fulfillment_private.ebay_supplier_products (
store_id uuid not null references public.stores(id) on delete cascade,
item_id text not null, asin text not null check(asin ~ '^[A-Z0-9]{10}$'),
updated_at timestamptz not null default now(), primary key(store_id,item_id));
alter table fulfillment_private.ebay_supplier_products enable row level security;
create or replace function public.ebay_supplier_products_get(target uuid, item_ids text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
if coalesce(array_length(item_ids,1),0)>500 then raise exception 'Too many items'; end if;
return coalesce((select jsonb_object_agg(item_id,asin) from fulfillment_private.ebay_supplier_products where store_id=target and item_id=any(item_ids)),'{}');
end $$;
create or replace function public.ebay_supplier_product_save(target uuid,item_id text,product_asin text,expected_asin text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved text;
begin
if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
if product_asin is null or product_asin !~ '^[A-Z0-9]{10}$' then raise exception 'Invalid Amazon ASIN'; end if;
if not exists(select 1 from fulfillment_private.ebay_records r where r.store_id=target and ((r.resource='listings' and r.external_id=item_id) or (r.resource='orders' and exists(select 1 from jsonb_array_elements(r.data->'lineItems') li where li->>'legacyItemId'=item_id)))) then raise exception 'Store item not found'; end if;
insert into fulfillment_private.ebay_supplier_products as p(store_id,item_id,asin) values(target,item_id,product_asin)
on conflict on constraint ebay_supplier_products_pkey do update set asin=excluded.asin,updated_at=now() where p.asin=expected_asin
returning asin into saved;
if saved is null then raise exception 'Product link changed in another session. Reopen to review the latest link.'; end if;
return jsonb_build_object('asin',saved);
end $$;
revoke all on function public.ebay_supplier_products_get(uuid,text[]),public.ebay_supplier_product_save(uuid,text,text,text) from public,anon;
grant execute on function public.ebay_supplier_products_get(uuid,text[]),public.ebay_supplier_product_save(uuid,text,text,text) to authenticated;
