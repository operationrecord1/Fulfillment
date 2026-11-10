-- Preserve the existing validator and access rules behind the spreadsheet API.
alter table fulfillment_private.order_rows add column deleted_at timestamptz;
with ranked as (select id,row_number() over(partition by store_id,year,month order by position,id) n from fulfillment_private.order_rows)
update fulfillment_private.order_rows t set position=r.n from ranked r where t.id=r.id;
-- Empty interior positions remain represented by gaps, not empty database rows.
update fulfillment_private.order_rows set deleted_at=now() where not exists(select 1 from jsonb_each_text(data) x where nullif(x.value,'') is not null);
create table fulfillment_private.order_periods (
 store_id uuid not null references public.stores(id),year integer not null,month integer not null,
 revision integer not null default 0,primary key(store_id,year,month)
);
create table fulfillment_private.grid_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,store_id uuid not null references public.stores(id),
 preferences jsonb not null default '{}'::jsonb,revision integer not null default 1,
 primary key(user_id,store_id),check(jsonb_typeof(preferences)='object' and octet_length(preferences::text)<500000)
);
alter table fulfillment_private.order_periods enable row level security;
alter table fulfillment_private.grid_preferences enable row level security;
revoke all on fulfillment_private.order_periods,fulfillment_private.grid_preferences from public,anon,authenticated;
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.order_workspace(text,jsonb)'::regprocedure);
 definition:=replace(definition,'FUNCTION public.order_workspace','FUNCTION fulfillment_private.order_workspace');
 definition:=replace(definition,'where store_id=p.store_id and year=yr','where store_id=p.store_id and year=yr and deleted_at is null');
 definition:=replace(definition,'lag(data) over(partition by month order by position,id) previous','lag(position) over(partition by month order by position,id) previous_position,lag(data) over(partition by month order by position,id) previous');
 definition:=replace(definition,'sum(case when (nullif','sum(case when position=previous_position+1 and ((nullif');
 definition:=replace(definition,'then 0 else 1 end)',') then 0 else 1 end)');
 execute definition;
end $migration$;
revoke all on function fulfillment_private.order_workspace(text,jsonb) from public,anon,authenticated;

create or replace function public.order_workspace(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; result jsonb; item jsonb; saved jsonb; existing fulfillment_private.order_rows;
 yr integer; mon integer; expected integer; rev integer; pos integer; seen uuid[]:=array[]::uuid[];
 keys text[]:=array[]::text[]; positions integer[]:=array[]::integer[]; mappings jsonb:='[]'; pref jsonb;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active;
 if p.user_id is null or p.store_id is null or p.role::text not in ('staff','investor') then raise exception 'An active assigned store account is required' using errcode='42501';end if;
 if action='read' then
  result:=fulfillment_private.order_workspace(action,payload);
  select jsonb_build_object('value',preferences,'revision',revision) into pref from fulfillment_private.grid_preferences where user_id=p.user_id and store_id=p.store_id;
  return result||jsonb_build_object('period_revisions',coalesce((select jsonb_object_agg(month,revision) from fulfillment_private.order_periods where store_id=p.store_id and year=(payload->>'year')::integer),'{}'::jsonb),'grid_preferences',coalesce(pref,'{"value":{},"revision":0}'::jsonb));
 elsif action='grid_preferences' then
  if jsonb_typeof(payload->'value')<>'object' then raise exception 'Invalid dimensions';end if;
  insert into fulfillment_private.grid_preferences(user_id,store_id,preferences) values(p.user_id,p.store_id,payload->'value')
  on conflict(user_id,store_id) do update set preferences=excluded.preferences,revision=fulfillment_private.grid_preferences.revision+1
  where fulfillment_private.grid_preferences.revision=(payload->>'revision')::integer returning revision into rev;
  if not found then raise exception 'Grid dimensions changed in another tab. Refresh before resizing';end if;
  return jsonb_build_object('revision',rev);
 elsif action='grid_commit' then
  if p.role::text<>'staff' then raise exception 'View-only access' using errcode='42501';end if;
  yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;expected:=(payload->>'revision')::integer;
  if yr is null or yr not between 2000 and 2100 or mon is null or mon not between 1 and 12 or expected is null then raise exception 'Invalid period';end if;
  if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows')>20000 then raise exception 'Invalid row batch';end if;
  insert into fulfillment_private.order_periods(store_id,year,month) values(p.store_id,yr,mon) on conflict do nothing;
  select revision into rev from fulfillment_private.order_periods where store_id=p.store_id and year=yr and month=mon for update;
  if rev<>expected then raise exception 'This month changed in another session. Refresh before saving';end if;
  for item in select value from jsonb_array_elements(payload->'rows') loop
   pos:=(item->>'position')::integer;
   if pos is null or pos not between 1 and 100000 or pos=any(positions) or nullif(item->>'key','') is null or item->>'key'=any(keys) then raise exception 'Invalid or duplicate row position';end if;
   positions:=array_append(positions,pos);keys:=array_append(keys,item->>'key');
   if not exists(select 1 from jsonb_each_text(item->'data') x where nullif(x.value,'') is not null) then continue;end if;
   if nullif(item->>'id','') is not null then
    select * into existing from fulfillment_private.order_rows where id=(item->>'id')::uuid and store_id=p.store_id and year=yr and month=mon;
    if not found or existing.id=any(seen) then raise exception 'Invalid row identity';end if;
    if existing.data=item->'data' and existing.position=pos and existing.deleted_at is null then saved:=to_jsonb(existing);
    else
     saved:=fulfillment_private.order_workspace('save_row',jsonb_build_object('id',existing.id,'revision',existing.revision,'year',yr,'month',mon,'position',pos,'data',item->'data'));
     update fulfillment_private.order_rows set position=pos,deleted_at=null where id=existing.id;
    end if;
   else
    saved:=fulfillment_private.order_workspace('save_row',jsonb_build_object('year',yr,'month',mon,'position',pos,'data',item->'data'));
   end if;
   seen:=array_append(seen,(saved->>'id')::uuid);
   mappings:=mappings||jsonb_build_array(jsonb_build_object('key',item->>'key','id',saved->>'id','revision',saved->'revision'));
  end loop;
  update fulfillment_private.order_rows set deleted_at=now(),revision=revision+1 where store_id=p.store_id and year=yr and month=mon and deleted_at is null and not(id=any(seen));
  update fulfillment_private.order_periods set revision=revision+1 where store_id=p.store_id and year=yr and month=mon returning revision into rev;
  return jsonb_build_object('revision',rev,'mappings',mappings);
 elsif action in ('save_row','delete_row') then
  raise exception 'The spreadsheet has been upgraded. Reload the page before editing';
 else
  return fulfillment_private.order_workspace(action,payload);
 end if;
end $$;
revoke all on function public.order_workspace(text,jsonb) from public,anon;
grant execute on function public.order_workspace(text,jsonb) to authenticated;
