-- Store-scoped order workspace. Only the guarded RPC exposes private records.
create schema if not exists fulfillment_private;
revoke all on schema fulfillment_private from public, anon, authenticated;
create table fulfillment_private.order_rows (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 year integer not null check(year between 2000 and 2100),
 month integer not null check(month between 1 and 12),
 position numeric not null,
 data jsonb not null default '{}'::jsonb,
 revision integer not null default 1,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(data)='object' and octet_length(data::text)<20000)
);
create index order_rows_period on fulfillment_private.order_rows(store_id,year,month,position,id);
create table fulfillment_private.store_options (
 store_id uuid primary key references public.stores(id),
 platforms text[] not null default array['Amazon'],
 revision integer not null default 1
);
create table fulfillment_private.expenses (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),
 name text not null check(length(name) between 1 and 120),
 amount numeric(14,2) not null check(amount>0),date date not null,
 type text not null check(type in ('Subscription','Software','Operation','Other')),
 revision integer not null default 1
);
create index expenses_store_date on fulfillment_private.expenses(store_id,date);
alter table fulfillment_private.order_rows enable row level security;
alter table fulfillment_private.store_options enable row level security;
alter table fulfillment_private.expenses enable row level security;
revoke all on all tables in schema fulfillment_private from public,anon,authenticated;

create or replace function public.order_workspace(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; r fulfillment_private.order_rows; e fulfillment_private.expenses;
 d jsonb; result jsonb; rows_data jsonb; opts jsonb; k text; n numeric; yr integer; mon integer; rid uuid;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active;
 if p.user_id is null or p.store_id is null or p.role::text not in ('staff','investor') then
   raise exception 'An active assigned store account is required' using errcode='42501';
 end if;
 if action='read' then
   yr:=(payload->>'year')::integer;
   if yr not between 2000 and 2100 then raise exception 'Invalid year'; end if;
   with ordered as (
    select t.*,lag(data) over(partition by month order by position,id) previous
    from fulfillment_private.order_rows t where store_id=p.store_id and year=yr
   ), numbered as (
    select *,sum(case when (nullif(data->>'order_id','') is not null and data->>'order_id'=previous->>'order_id')
      or (nullif(data->>'purchase_id','') is not null and data->>'purchase_id'=previous->>'purchase_id') then 0 else 1 end)
      over(partition by month order by position,id) group_no from ordered
   ), grouped as (
    select *,month::text||'-'||group_no::text group_key,
    sum(nullif(data->>'earning','')::numeric) over(partition by month,group_no) rev,
    sum(nullif(data->>'product_cost','')::numeric) over(partition by month,group_no) cost,
    sum(coalesce(nullif(data->>'shipping_cost','')::numeric,0)+coalesce(nullif(data->>'additional_cost','')::numeric,0)) over(partition by month,group_no) other_cost
    from numbered
   ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'month',month,'year',year,'position',position,'revision',revision,
       'group_key',group_key,'group_profit',case when rev is not null and cost is not null then rev-cost-other_cost end,
       'group_margin',case when rev<>0 and cost is not null then greatest(-100,least(100,(rev-cost-other_cost)/rev*100)) end,
       'data',case when p.role::text='staff' then data else jsonb_build_object(
         'order_id',data->'order_id','order_url',data->'order_url','quantity',data->'quantity','earning',data->'earning',
         'status',data->'status','product_cost',data->'product_cost','shipping_cost',data->'shipping_cost',
         'additional_cost',data->'additional_cost','date',data->'date') end) order by month,position,id),'[]'::jsonb)
     into rows_data from grouped;
   select jsonb_build_object('platforms',platforms,'revision',revision) into opts from fulfillment_private.store_options where store_id=p.store_id;
   return jsonb_build_object('rows',rows_data,'options',coalesce(opts,'{"platforms":["Amazon"],"revision":0}'::jsonb),
     'store_name',(select name from public.stores where id=p.store_id),
     'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',case when p.role::text='staff' then name else 'Store expense' end,
      'amount',amount,'date',date,'type',type,'revision',revision) order by date,id) from fulfillment_private.expenses where store_id=p.store_id and extract(year from date)=yr),'[]'::jsonb));
 end if;
 if p.role::text<>'staff' then raise exception 'View-only access' using errcode='42501'; end if;
 if action='save_row' then
   d:=payload->'data'; yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;
   if d is null or jsonb_typeof(d)<>'object' then raise exception 'Invalid row'; end if;
   for k in select jsonb_object_keys(d) loop
    if k not in ('order_id','order_url','quantity','earning','purchase_id','purchase_url','supplier','note','platform','tracking','secondary_tracking','status','product_cost','shipping_cost','additional_cost','date') then raise exception 'Unknown field'; end if;
    if jsonb_typeof(d->k) not in ('string','number','null') or length(d->>k)>2000 then raise exception 'Invalid field'; end if;
   end loop;
   foreach k in array array['quantity','earning','product_cost','shipping_cost','additional_cost'] loop
    if nullif(d->>k,'') is not null then
     n:=(d->>k)::numeric;
     if n::text in ('NaN','Infinity','-Infinity') or abs(n)>1000000000 or (k<>'earning' and n<0) or (k='quantity' and n<>trunc(n)) then raise exception 'Invalid numeric value';end if;
     d:=jsonb_set(d,array[k],to_jsonb(round(n,2)));
    end if;
   end loop;
   if nullif(d->>'date','') is not null and (extract(year from (d->>'date')::date)<>yr or extract(month from (d->>'date')::date)<>mon) then raise exception 'Order date must match the selected month and year';end if;
   if nullif(d->>'status','') is not null and d->>'status' not in ('Pending','Processed','Delivered','Label Created','Buyer Cancelled','Refunded','OOS','Alert') then raise exception 'Invalid order status';end if;
   if nullif(d->>'platform','') is not null and not (d->>'platform'=any(coalesce((select platforms from fulfillment_private.store_options where store_id=p.store_id),array['Amazon']))) then
     if not exists(select 1 from fulfillment_private.order_rows where id=(payload->>'id')::uuid and store_id=p.store_id and data->>'platform'=d->>'platform') then raise exception 'Choose a configured platform';end if;
   end if;
   rid:=nullif(payload->>'id','')::uuid;
   if rid is null then
     insert into fulfillment_private.order_rows(store_id,year,month,position,data) values(p.store_id,yr,mon,(payload->>'position')::numeric,d) returning * into r;
   else
     update fulfillment_private.order_rows set data=d,revision=revision+1,updated_at=now()
       where id=rid and store_id=p.store_id and revision=(payload->>'revision')::integer and year=yr and month=mon returning * into r;
     if not found then raise exception 'This row changed in another session. Refresh before editing';end if;
   end if;
   return to_jsonb(r)-'store_id';
 elsif action='delete_row' then
   delete from fulfillment_private.order_rows where id=(payload->>'id')::uuid and store_id=p.store_id and revision=(payload->>'revision')::integer;
   if not found then raise exception 'This row changed in another session. Refresh before deleting';end if;
   return '{"ok":true}'::jsonb;
 elsif action='platforms' then
   if jsonb_typeof(payload->'platforms')<>'array' or jsonb_array_length(payload->'platforms')>50 then raise exception 'Maximum 50 platforms';end if;
   if exists(select 1 from jsonb_array_elements_text(payload->'platforms') x where length(btrim(x)) not between 1 and 60) then raise exception 'Invalid platform name';end if;
   insert into fulfillment_private.store_options(store_id,platforms) values(p.store_id,array(select distinct btrim(x) from jsonb_array_elements_text(payload->'platforms') x))
   on conflict(store_id) do update set platforms=excluded.platforms,revision=fulfillment_private.store_options.revision+1
   where fulfillment_private.store_options.revision=(payload->>'revision')::integer;
   if not found then raise exception 'Settings changed. Refresh before saving';end if;
   return '{"ok":true}'::jsonb;
 elsif action='save_expense' then
   if nullif(payload->>'id','') is null then
    insert into fulfillment_private.expenses(store_id,name,amount,date,type) values(p.store_id,btrim(payload->>'name'),(payload->>'amount')::numeric,(payload->>'date')::date,payload->>'type') returning * into e;
   else
    update fulfillment_private.expenses set name=btrim(payload->>'name'),amount=(payload->>'amount')::numeric,date=(payload->>'date')::date,type=payload->>'type',revision=revision+1
    where id=(payload->>'id')::uuid and store_id=p.store_id and revision=(payload->>'revision')::integer returning * into e;
    if not found then raise exception 'Expense changed. Refresh before saving';end if;
   end if;
   return to_jsonb(e)-'store_id';
 elsif action='delete_expense' then
   delete from fulfillment_private.expenses where id=(payload->>'id')::uuid and store_id=p.store_id and revision=(payload->>'revision')::integer;
   if not found then raise exception 'Expense changed. Refresh before deleting';end if;
   return '{"ok":true}'::jsonb;
 end if;
 raise exception 'Unknown workspace action';
end $$;
revoke all on function public.order_workspace(text,jsonb) from public,anon;
grant execute on function public.order_workspace(text,jsonb) to authenticated;
