create or replace function public.sheets_worker(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token uuid; job fulfillment_private.sheets_jobs; target fulfillment_private.sheets_targets;
 cfg fulfillment_private.sheets_control; result jsonb; secret_id uuid;
begin
 if action='claim' then
  select * into cfg from fulfillment_private.sheets_control where singleton for update;
  if not cfg.enabled or cfg.lease_until>now() then return null;end if;
  select j.* into job from fulfillment_private.sheets_jobs j join fulfillment_private.sheets_targets t using(employee_id)
  where t.active and j.version>j.completed_version and j.available_at<=now()
  order by j.available_at,j.employee_id,j.year limit 1;
  if not found then return null;end if;
  token:=gen_random_uuid();
  update fulfillment_private.sheets_control set lease_token=token,lease_until=now()+interval '5 minutes' where singleton;
  select * into target from fulfillment_private.sheets_targets where employee_id=job.employee_id;
  return jsonb_build_object('token',token,'job',to_jsonb(job),'target',to_jsonb(target),
   'formats',coalesce((select jsonb_object_agg(month,cells) from fulfillment_private.order_formats where store_id=target.store_id and year=job.year),'{}'::jsonb),
   'rows',coalesce((select jsonb_agg(r order by r.month,r.position) from fulfillment_private.order_rows r
    where r.store_id=target.store_id and r.year=job.year and r.deleted_at is null),'[]'::jsonb));
 elsif action='snapshot' then
  select * into target from fulfillment_private.sheets_targets where employee_id=(payload->>'employee_id')::uuid;
  select * into job from fulfillment_private.sheets_jobs where employee_id=target.employee_id and year=(payload->>'year')::integer;
  if target.employee_id is null or job.employee_id is null then raise exception 'Mirror not found';end if;
  return jsonb_build_object('target',to_jsonb(target),'job',to_jsonb(job),
   'formats',coalesce((select jsonb_object_agg(month,cells) from fulfillment_private.order_formats where store_id=target.store_id and year=job.year),'{}'::jsonb),
   'rows',coalesce((select jsonb_agg(r order by r.month,r.position) from fulfillment_private.order_rows r where r.store_id=target.store_id and r.year=job.year and r.deleted_at is null),'[]'::jsonb));
 elsif action='credentials' then
  return coalesce((select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets
   where name in ('sheets_google_client_id','sheets_google_client_secret','sheets_google_refresh_token')),'{}'::jsonb);
 elsif action='oauth_begin' then
  delete from fulfillment_private.sheets_oauth_states where expires_at<now();
  insert into fulfillment_private.sheets_oauth_states values(payload->>'hash',payload->>'verifier',now()+interval '10 minutes');return '{}'::jsonb;
 elsif action='oauth_consume' then
  delete from fulfillment_private.sheets_oauth_states where state_hash=payload->>'hash' and expires_at>now() returning jsonb_build_object('verifier',verifier) into result;
  return result;
 elsif action='oauth_save' then
  if payload->>'email'<>'operation.record1@gmail.com' or length(coalesce(payload->>'refresh_token',''))<20 then raise exception 'Wrong owner or missing token';end if;
  select id into secret_id from vault.secrets where name='sheets_google_refresh_token';
  if secret_id is null then perform vault.create_secret(payload->>'refresh_token','sheets_google_refresh_token');
  else perform vault.update_secret(secret_id,payload->>'refresh_token');end if;
  -- Enable explicitly after the first controlled verification, not during authorization.
  return '{"connected":true}'::jsonb;
 end if;
 select * into cfg from fulfillment_private.sheets_control where singleton for update;
 if cfg.lease_token is distinct from (payload->>'token')::uuid or cfg.lease_until<now() then raise exception 'Worker lease expired';end if;
 select * into target from fulfillment_private.sheets_targets where employee_id=(payload->>'employee_id')::uuid;
 if action='check' then return jsonb_build_object('active',target.active and exists(select 1 from public.profiles where user_id=target.employee_id and is_active and role='staff'));
 elsif action='prepare_create' then
  if not target.active or target.create_started_at is not null then raise exception 'Spreadsheet creation requires reconciliation';end if;
  update fulfillment_private.sheets_targets set create_started_at=now() where employee_id=target.employee_id;
 elsif action='bind' then
  if not target.active then raise exception 'Employee archived';end if;
  if target.spreadsheet_id is not null and target.spreadsheet_id<>payload->>'spreadsheet_id' then raise exception 'Spreadsheet already bound';end if;
  update fulfillment_private.sheets_targets set spreadsheet_id=payload->>'spreadsheet_id',create_started_at=null where employee_id=target.employee_id;
 elsif action='finish' then
  update fulfillment_private.sheets_jobs set completed_version=(payload->>'version')::bigint,attempts=0,last_error=null,synced_at=now(),extents=payload->'extents',progress='{}'::jsonb
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='checkpoint' then
  update fulfillment_private.sheets_jobs set progress=payload->'progress',extents=payload->'extents'
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='yield' then
  update fulfillment_private.sheets_jobs set available_at=now(),last_error=null
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 elsif action='fail' then
  update fulfillment_private.sheets_jobs set attempts=attempts+1,last_error=left(payload->>'error',300),
   available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
  where employee_id=target.employee_id and year=(payload->>'year')::integer;
 else raise exception 'Invalid worker action';end if;
 if action in ('finish','fail','yield') then update fulfillment_private.sheets_control set lease_token=null,lease_until=null where singleton;end if;
 return '{}'::jsonb;
end $$;
