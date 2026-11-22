-- Read-only eBay mirror. Tokens and imported data remain server-side.
create table fulfillment_private.ebay_sync_jobs (
 store_id uuid not null references fulfillment_private.ebay_connections(store_id),
 resource text not null check(resource in ('orders','listings','returns','transactions','traffic','listing_traffic')),
 cursor jsonb not null default '{}', watermark timestamptz,
 available_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 last_success timestamptz, last_error text, failures integer not null default 0,
 primary key(store_id,resource)
);
create table fulfillment_private.ebay_records (
 store_id uuid not null references fulfillment_private.ebay_connections(store_id),
 resource text not null, external_id text not null, data jsonb not null,
 updated_at timestamptz not null default now(), primary key(store_id,resource,external_id)
);
alter table fulfillment_private.ebay_sync_jobs enable row level security;
alter table fulfillment_private.ebay_records enable row level security;
revoke all on fulfillment_private.ebay_sync_jobs,fulfillment_private.ebay_records from public,anon,authenticated;

create function public.ebay_sync_worker(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j fulfillment_private.ebay_sync_jobs; c fulfillment_private.ebay_connections; t jsonb; r jsonb; target uuid; token uuid;
begin
 if action='claim' then
  -- Serialize claim selection, including claims for different resources of one seller.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ebay_sync_claim',0));
  update fulfillment_private.ebay_sync_jobs set cursor='{}',watermark=null,reset_requested=false,available_at=now() where reset_requested and coalesce(lease_until,now())<=now();
  insert into fulfillment_private.ebay_sync_jobs(store_id,resource)
  select store_id,k from fulfillment_private.ebay_connections cross join unnest(array['orders','listings','returns','transactions','traffic','listing_traffic']) k on conflict do nothing;
  select * into j from fulfillment_private.ebay_sync_jobs a where a.available_at<=now()
   and coalesce(a.lease_until,now())<=now()
   and (a.resource<>'listing_traffic' or exists(select 1 from fulfillment_private.ebay_sync_jobs l where l.store_id=a.store_id and l.resource='listings' and l.last_success is not null))
   and not exists(select 1 from fulfillment_private.ebay_sync_jobs b where b.store_id=a.store_id and b.lease_until>now())
   order by a.available_at,a.store_id,a.resource for update skip locked limit 1;
  if not found then return null; end if;
  token=gen_random_uuid();
  update fulfillment_private.ebay_sync_jobs set lease_id=token,lease_until=now()+interval '90 seconds' where store_id=j.store_id and resource=j.resource;
  select * into c from fulfillment_private.ebay_connections where store_id=j.store_id;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  return to_jsonb(j)||jsonb_build_object('lease_id',token,'tokens',t,'access_expires_at',c.access_expires_at,'refresh_expires_at',c.refresh_expires_at,
   'listing_ids',case when j.resource='listing_traffic' then coalesce((select jsonb_agg(external_id order by external_id) from (select external_id from fulfillment_private.ebay_records where store_id=j.store_id and resource='listings' and external_id>coalesce(j.cursor->>'after','') order by external_id limit 50) x),'[]'::jsonb) else null end);
 end if;
 target=(payload->>'store_id')::uuid;
 select * into j from fulfillment_private.ebay_sync_jobs where store_id=target and resource=payload->>'resource' and lease_id=(payload->>'lease_id')::uuid and lease_until>now() for update;
 if not found then raise exception 'Sync lease expired'; end if;
 if action='token' then
  select * into c from fulfillment_private.ebay_connections where store_id=target for update;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  if length(payload->'tokens'->>'access_token')<10 or (payload->'tokens'->>'expires_in')::integer<=0 then raise exception 'Invalid token response'; end if;
  perform vault.update_secret(c.token_secret_id,(t||(payload->'tokens'))::text);
  update fulfillment_private.ebay_connections set access_expires_at=now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer),updated_at=now() where store_id=target;
 elsif action='commit' then
  for r in select value from jsonb_array_elements(payload->'records') loop
   if coalesce(r->>'id','')='' then raise exception 'Missing eBay record ID'; end if;
   insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values(target,j.resource,r->>'id',r->'data')
    on conflict(store_id,resource,external_id) do update set data=excluded.data,updated_at=now();
  end loop;
  if j.resource='listings' and payload ? 'reconcile_active_before' then
   update fulfillment_private.ebay_records set data=data||'{"catalog_present":false}'::jsonb where store_id=target and resource='listings' and data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}'='ACTIVE' and updated_at<(payload->>'reconcile_active_before')::timestamptz;
  end if;
  update fulfillment_private.ebay_sync_jobs set cursor=coalesce(payload->'cursor','{}'),
   watermark=case when (payload->>'done')::boolean then (payload->>'watermark')::timestamptz else watermark end,
   last_success=case when (payload->>'done')::boolean then now() else last_success end,
   available_at=now()+make_interval(secs=>case when not (payload->>'done')::boolean then 0 when resource='orders' then 120 when resource in ('traffic','listing_traffic') then 21600 else 600 end),
   lease_id=null,lease_until=null,last_error=null,failures=0 where store_id=target and resource=j.resource;
 elsif action='fail' then
  update fulfillment_private.ebay_sync_jobs set last_error=left(payload->>'error',160),failures=failures+1,
   available_at=now()+make_interval(secs=>least(21600,greatest(60,coalesce((payload->>'retry_after')::integer,0),60*power(2,least(failures,8))::integer))),
   lease_id=null,lease_until=null where store_id=target and resource=j.resource;
 else raise exception 'Unknown sync operation'; end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.ebay_sync_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_sync_worker(text,jsonb) to service_role;

create function public.ebay_store_status(target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 select jsonb_build_object('connected',true,'username',c.username,'connected_at',c.connected_at,'refresh_expires_at',c.refresh_expires_at,
 'jobs',coalesce((select jsonb_agg(jsonb_build_object('resource',j.resource,'last_success',j.last_success,'last_error',j.last_error,'next_run',j.available_at,'count',(select count(*) from fulfillment_private.ebay_records r where r.store_id=target and r.resource=j.resource))) from fulfillment_private.ebay_sync_jobs j where j.store_id=target),'[]'::jsonb)) into result from fulfillment_private.ebay_connections c where store_id=target;
 return coalesce(result,'{"connected":false}'::jsonb);
end $$;
revoke all on function public.ebay_store_status(uuid) from public,anon;
grant execute on function public.ebay_store_status(uuid) to authenticated;

create function fulfillment_private.ebay_dispatch() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not exists(select 1 from fulfillment_private.ebay_connections) then return; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='fulfillment_webhook_secret';
 if secret is null then return; end if;
 perform net.http_post(url:='https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/ebay-sync',headers:=jsonb_build_object('Content-Type','application/json','x-fulfillment-webhook-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=120000);
end $$;
revoke all on function fulfillment_private.ebay_dispatch() from public,anon,authenticated;
