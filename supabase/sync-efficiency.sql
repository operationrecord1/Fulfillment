-- Work is bounded by changed/due orders, not all retained history.
create table fulfillment_private.delivery_due (
 store_id uuid not null references public.stores(id),order_id text not null,
 next_check timestamptz not null default now(),primary key(store_id,order_id)
);
create index delivery_due_ready on fulfillment_private.delivery_due(store_id,next_check,order_id);
alter table fulfillment_private.delivery_due enable row level security;
create table fulfillment_private.refund_dirty (
 store_id uuid not null references public.stores(id),order_id text not null,
 changed_at timestamptz not null default now(),primary key(store_id,order_id)
);
alter table fulfillment_private.refund_dirty enable row level security;
create table fulfillment_private.commerce_versions (
 store_id uuid primary key references public.stores(id),revision bigint not null default 1
);
alter table fulfillment_private.commerce_versions enable row level security;
revoke all on fulfillment_private.delivery_due,fulfillment_private.refund_dirty,fulfillment_private.commerce_versions from public,anon,authenticated;
create index if not exists ebay_return_order_lookup on fulfillment_private.ebay_records(store_id,(data->>'orderId')) where resource='returns';

create function fulfillment_private.schedule_delivery(s uuid,oid text,observed boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare o jsonb;d jsonb;manual text;next_time timestamptz;
begin
 select data into o from fulfillment_private.ebay_records where store_id=s and resource='orders' and external_id=oid;
 select data into d from fulfillment_private.ebay_records where store_id=s and resource='delivery_tracking' and external_id=oid;
 select case when e.data ? 'status' then e.data->>'status' else
 (select w.data->>'status' from fulfillment_private.order_rows w where w.store_id=s and btrim(w.data->>'order_id')=oid and nullif(w.data->>'status','') is not null order by year,month,position limit 1) end
 into manual from (select 1) x left join fulfillment_private.ebay_order_edits e on e.store_id=s and e.order_id=oid;
 if o is null or coalesce(o->>'creationDate','')<to_char((now()-interval '89 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
 or o->>'orderPaymentStatus'='FULLY_REFUNDED' or o#>>'{cancelStatus,cancelState}'='CANCELED'
 or (d->>'source'='ebay_get_orders' and nullif(d->>'deliveredAt','') is not null)
 or manual in ('Alert','OOS','Refunded') then
  delete from fulfillment_private.delivery_due where store_id=s and order_id=oid;return;
 end if;
 next_time=case when observed then now()+case when o->>'orderFulfillmentStatus'='FULFILLED' or d->>'hasTracking'='true' or manual='Due Refund' then interval '5 minutes' else interval '30 minutes' end else now() end;
 insert into fulfillment_private.delivery_due values(s,oid,next_time)
 on conflict(store_id,order_id) do update set next_check=case when observed then excluded.next_check else least(delivery_due.next_check,excluded.next_check) end;
end $$;
revoke all on function fulfillment_private.schedule_delivery(uuid,text,boolean) from public,anon,authenticated;

create function fulfillment_private.commerce_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare s uuid;oid text;v jsonb;prior jsonb;res text;meaningful boolean:=true;
begin
 v=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 prior=case when TG_OP='UPDATE' then to_jsonb(old) else null end;
 s=(v->>'store_id')::uuid;
 if s is null then return null; end if;
 if TG_TABLE_NAME='ebay_records' then
  res=v->>'resource';oid=case when res='returns' then v#>>'{data,orderId}' else v->>'external_id' end;
  meaningful=prior is null or ((v->'data')-'observedAt') is distinct from ((prior->'data')-'observedAt');
  if res='delivery_tracking' and TG_OP<>'DELETE' then perform fulfillment_private.schedule_delivery(s,oid,true);
  elsif res='orders' and meaningful then perform fulfillment_private.schedule_delivery(s,oid);end if;
  if res not in ('orders','returns','delivery_tracking') then oid=null;end if;
 elsif TG_TABLE_NAME='ebay_order_edits' then
  oid=v->>'order_id';meaningful=prior is null or v->'data' is distinct from prior->'data';
  if meaningful then perform fulfillment_private.schedule_delivery(s,oid);end if;
 elsif TG_TABLE_NAME='order_rows' then
  oid=btrim(v#>>'{data,order_id}');meaningful=prior is null or v->'data' is distinct from prior->'data';
  if meaningful and nullif(oid,'') is not null then perform fulfillment_private.schedule_delivery(s,oid);end if;
 else
  meaningful=prior is null or (v-'updated_at') is distinct from (prior-'updated_at');
 end if;
 if meaningful then
  insert into fulfillment_private.commerce_versions values(s,1) on conflict(store_id) do update set revision=commerce_versions.revision+1;
  if nullif(oid,'') is not null then insert into fulfillment_private.refund_dirty values(s,oid,now()) on conflict(store_id,order_id) do update set changed_at=excluded.changed_at;end if;
 end if;
 return null;
end $$;
revoke all on function fulfillment_private.commerce_changed() from public,anon,authenticated;
do $$ declare tab text; begin
 foreach tab in array array['ebay_records','ebay_order_edits','order_rows','ebay_supplier_products','ebay_note_outbox','ebay_note_jobs'] loop
 execute format('create trigger commerce_changed after insert or update or delete on fulfillment_private.%I for each row execute function fulfillment_private.commerce_changed()',tab);
 end loop;
end $$;
-- Initial backfill is local only; no additional eBay calls.
do $$ declare r record;begin
 for r in select store_id,external_id from fulfillment_private.ebay_records where resource='orders' loop
 perform fulfillment_private.schedule_delivery(r.store_id,r.external_id);
 end loop;
end $$;
insert into fulfillment_private.refund_dirty(store_id,order_id) select store_id,external_id from fulfillment_private.ebay_records where resource='orders' on conflict do nothing;

create function public.ebay_workspace_revision(target uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required';end if;
 return coalesce((select revision::text from fulfillment_private.commerce_versions where store_id=target),'0');
end $$;
revoke all on function public.ebay_workspace_revision(uuid) from public,anon;
grant execute on function public.ebay_workspace_revision(uuid) to authenticated;

-- Narrow the existing proven worker without changing its earnings or status logic.
do $$ declare def text;needle text;replacement text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='ebay_sync_worker';
 needle='select external_id from fulfillment_private.ebay_records where store_id=j.store_id and resource=''orders'' and external_id>coalesce(j.cursor->>''after'','''') and (data->>''creationDate'')::timestamptz>now()-interval ''89 days'' order by external_id limit 50';
 replacement='select order_id as external_id from fulfillment_private.delivery_due where store_id=j.store_id and next_check<=now() order by next_check,order_id limit 50';
 if position(needle in def)=0 then raise exception 'Delivery selector changed; review before patch';end if;
 def=replace(def,needle,replacement);
 def=replace(def,'when resource in (''transactions'',''delivery_tracking'') then 120','when resource=''transactions'' then 120 when resource=''delivery_tracking'' then 60');
 -- Overdue lanes must not starve behind continuous order imports.
 def=replace(def,'order by case when a.resource=''orders'' then 0','order by case when a.available_at<now()-interval ''15 minutes'' then -1 when a.resource=''orders'' then 0');
 execute def;
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='ebay_resync_store';
 def=replace(def,'reset_requested=resource in (''orders'',''listings'')','reset_requested=false');
 execute def;
end $$;
