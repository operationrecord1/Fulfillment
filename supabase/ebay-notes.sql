-- Private durable outbox. Both note editors use the existing revision-checked save RPC.
create table fulfillment_private.ebay_note_outbox (
 store_id uuid not null references public.stores(id), order_id text not null,
 note text not null, version uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now(), last_error text,
 primary key(store_id,order_id)
);
create table fulfillment_private.ebay_note_jobs (
 store_id uuid primary key references fulfillment_private.ebay_connections(store_id),
 lease_id uuid, lease_until timestamptz, available_at timestamptz not null default now(),
 last_success timestamptz, last_error text
);
alter table fulfillment_private.ebay_note_outbox enable row level security;
alter table fulfillment_private.ebay_note_jobs enable row level security;
revoke all on fulfillment_private.ebay_note_outbox,fulfillment_private.ebay_note_jobs from public,anon,authenticated;

create or replace function fulfillment_private.ebay_notes_dispatch() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='fulfillment_webhook_secret';
 if secret is not null then
 perform net.http_post(url:='https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/ebay-notes',headers:=jsonb_build_object('Content-Type','application/json','x-fulfillment-webhook-secret',secret),body:='{}',timeout_milliseconds:=120000);
 end if;
end $$;
revoke all on function fulfillment_private.ebay_notes_dispatch() from public,anon,authenticated;

create or replace function fulfillment_private.ebay_note_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('fulfillment.note_import',true)='1' then return new; end if;
 if not (new.data ? 'note') then return new; end if;
 if TG_OP='UPDATE' and new.data->>'note' is not distinct from old.data->>'note' then return new; end if;
 if length(new.data->>'note')>255 then raise exception 'eBay Notes Can Contain Up to 255 Characters.'; end if;
 insert into fulfillment_private.ebay_note_outbox(store_id,order_id,note) values(new.store_id,new.order_id,new.data->>'note')
 on conflict(store_id,order_id) do update set note=excluded.note,version=gen_random_uuid(),updated_at=now(),last_error=null;
 insert into fulfillment_private.ebay_note_jobs(store_id) values(new.store_id)
 on conflict(store_id) do update set available_at=now();
 perform fulfillment_private.ebay_notes_dispatch();
 return new;
end $$;
revoke all on function fulfillment_private.ebay_note_enqueue() from public,anon,authenticated;
create trigger ebay_note_enqueue after insert or update of data on fulfillment_private.ebay_order_edits for each row execute function fulfillment_private.ebay_note_enqueue();

create or replace function public.ebay_note_worker(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j fulfillment_private.ebay_note_jobs; c fulfillment_private.ebay_connections; t jsonb; r record; result jsonb; target uuid; lease uuid;
begin
 if action='claim' then
  insert into fulfillment_private.ebay_note_jobs(store_id) select store_id from fulfillment_private.ebay_connections on conflict do nothing;
  select * into j from fulfillment_private.ebay_note_jobs where available_at<=now() and coalesce(lease_until,now())<=now() order by available_at for update skip locked limit 1;
  if not found then return null; end if;
  lease=gen_random_uuid();
  update fulfillment_private.ebay_note_jobs set lease_id=lease,lease_until=now()+interval '120 seconds' where store_id=j.store_id;
  select * into c from fulfillment_private.ebay_connections where store_id=j.store_id;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  return jsonb_build_object('store_id',j.store_id,'lease_id',lease,'tokens',t,'access_expires_at',c.access_expires_at,'outbox',coalesce((select jsonb_agg(to_jsonb(q)) from (
   select o.order_id,o.note,o.version,(select jsonb_agg(x->>'legacyItemId'||'-'||(x->>'lineItemId')) from jsonb_array_elements(e.data->'lineItems') x) line_ids
   from fulfillment_private.ebay_note_outbox o join fulfillment_private.ebay_records e on e.store_id=o.store_id and e.resource='orders' and e.external_id=o.order_id where o.store_id=j.store_id order by o.updated_at limit 25
  ) q),'[]'));
 end if;
 target=(payload->>'store_id')::uuid;
 select * into j from fulfillment_private.ebay_note_jobs where store_id=target and lease_id=(payload->>'lease_id')::uuid and lease_until>now() for update;
 if not found then raise exception 'Note Sync Lease Expired'; end if;
 if action='token' then
  select * into c from fulfillment_private.ebay_connections where store_id=target for update;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  perform vault.update_secret(c.token_secret_id,(t||(payload->'tokens'))::text);
  update fulfillment_private.ebay_connections set access_expires_at=now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer) where store_id=target;
 elsif action='sent' then
  delete from fulfillment_private.ebay_note_outbox where store_id=target and order_id=payload->>'order_id' and version=(payload->>'version')::uuid;
 elsif action='outbox_error' then
  update fulfillment_private.ebay_note_outbox set last_error=left(payload->>'error',220) where store_id=target and order_id=payload->>'order_id' and version=(payload->>'version')::uuid;
 elsif action='import' then
  perform set_config('fulfillment.note_import','1',true);
  for r in
   select e.external_id as order_id,string_agg(distinct coalesce(n->>'note',''),E'\n') as note
   from fulfillment_private.ebay_records e cross join lateral jsonb_array_elements(e.data->'lineItems') x
   join jsonb_array_elements(payload->'notes') n on n->>'line_id'=(x->>'legacyItemId')||'-'||(x->>'lineItemId')
   where e.store_id=target and e.resource='orders'
   and not exists(select 1 from fulfillment_private.ebay_note_outbox o where o.store_id=target and o.order_id=e.external_id)
   group by e.external_id having count(*)=jsonb_array_length(max(e.data::text)::jsonb->'lineItems')
  loop
   insert into fulfillment_private.ebay_order_edits(store_id,order_id,data) values(target,r.order_id,jsonb_build_object('note',r.note))
   on conflict(store_id,order_id) do update set data=ebay_order_edits.data||excluded.data,revision=ebay_order_edits.revision+1,updated_at=now()
   where ebay_order_edits.data->>'note' is distinct from excluded.data->>'note'
   and ebay_order_edits.updated_at < (payload->>'started_at')::timestamptz - interval '30 seconds';
  end loop;
 elsif action='finish' then
  update fulfillment_private.ebay_note_jobs set lease_id=null,lease_until=null,last_success=now(),last_error=null,available_at=now()+case when exists(select 1 from fulfillment_private.ebay_note_outbox where store_id=target and last_error is null) then interval '1 second' else interval '2 minutes' end where store_id=target;
 elsif action='fail' then
  update fulfillment_private.ebay_note_jobs set lease_id=null,lease_until=null,last_error=left(payload->>'error',220),available_at=now()+interval '5 minutes' where store_id=target;
 else raise exception 'Invalid Note Operation'; end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.ebay_note_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.ebay_note_worker(text,jsonb) to service_role;

create or replace function public.ebay_note_status(target uuid,order_ids text[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store Access Required'; end if;
 return jsonb_build_object('pending',coalesce((select jsonb_object_agg(order_id,jsonb_build_object('error',last_error)) from fulfillment_private.ebay_note_outbox where store_id=target and order_id=any(order_ids)),'{}'),'error',(select last_error from fulfillment_private.ebay_note_jobs where store_id=target));
end $$;
revoke all on function public.ebay_note_status(uuid,text[]) from public,anon;
grant execute on function public.ebay_note_status(uuid,text[]) to authenticated;
select cron.schedule('ebay-notes-sync','*/2 * * * *','select fulfillment_private.ebay_notes_dispatch()');
