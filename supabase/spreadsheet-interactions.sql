do $migration$
declare f text;
begin
f:=pg_get_functiondef('public.order_workspace(text,jsonb)'::regprocedure);
f:=replace(f, 'elsif prop.key=''align'' then', $insert$elsif prop.key='href' then
 if jsonb_typeof(prop.value)<>'string' or length(prop.value#>>'{}')>2000 or ((prop.value#>>'{}')<>'' and (prop.value#>>'{}') !~* '^https?://[^[:space:]]+$') then raise exception 'Invalid hyperlink';end if;
 elsif prop.key='options' then
 if cell_item.key not in ('platform','status') or jsonb_typeof(prop.value)<>'array' then raise exception 'Invalid cell options';end if;
 if jsonb_array_length(prop.value)>50 or exists(select 1 from jsonb_array_elements(prop.value) v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 60) then raise exception 'Invalid cell option';end if;
 elsif prop.key='align' then$insert$);
execute f;
end $migration$;

do $m$ declare f text; a integer;b integer;begin
f:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
a:=strpos(f,'   if nullif(d->>''status'','''') is not null');b:=strpos(f,'   rid:=nullif');
if a=0 or b<a then raise exception 'Expected validator not found';end if;
f:=substr(f,1,a-1)||'   if length(d->>''status'')>60 or length(d->>''platform'')>60 then raise exception ''Maximum 60 characters for dropdown values'';end if;'||chr(10)||substr(f,b);
execute f;end $m$;

create table fulfillment_private.order_edit_history(id bigint generated always as identity primary key,store_id uuid not null,row_id uuid not null,changed_at timestamptz not null default clock_timestamp(),actor uuid,old_data jsonb,new_data jsonb);
alter table fulfillment_private.order_edit_history enable row level security;
revoke all on fulfillment_private.order_edit_history from public,anon,authenticated;
create function fulfillment_private.record_order_edit() returns trigger language plpgsql security definer set search_path='' as $$ begin
if TG_OP='INSERT' then insert into fulfillment_private.order_edit_history(store_id,row_id,actor,old_data,new_data) values(new.store_id,new.id,auth.uid(),null,new.data);
elsif old.data is distinct from new.data or old.deleted_at is distinct from new.deleted_at then insert into fulfillment_private.order_edit_history(store_id,row_id,actor,old_data,new_data) values(new.store_id,new.id,auth.uid(),old.data,case when new.deleted_at is null then new.data else null end);end if;return new;end $$;
revoke all on function fulfillment_private.record_order_edit() from public,anon,authenticated;
create trigger order_edit_history after insert or update on fulfillment_private.order_rows for each row execute function fulfillment_private.record_order_edit();
do $m$ declare f text;begin f:=pg_get_functiondef('public.order_workspace(text,jsonb)'::regprocedure);
f:=replace(f,' if action=''grid_commit'' and payload ? ''formats'' then',$ins$ if action='history' then
if p.role::text<>'staff' then raise exception 'Employee access required' using errcode='42501';end if;
return coalesce((select jsonb_agg(x) from (select h.changed_at,h.old_data,h.new_data,coalesce(pr.display_name,'Store user') as actor from fulfillment_private.order_edit_history h left join public.profiles pr on pr.user_id=h.actor where h.store_id=p.store_id and h.row_id=(payload->>'row_id')::uuid order by h.id desc limit 100) x),'[]'::jsonb);
end if;
 if action='grid_commit' and payload ? 'formats' then$ins$);
execute f;end $m$;
