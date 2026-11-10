-- Shared display metadata, separate from order values and calculations.
create table fulfillment_private.order_formats (
 store_id uuid not null references public.stores(id), year integer not null check(year between 2000 and 2100),
 month integer not null check(month between 1 and 12), cells jsonb not null default '{}'::jsonb,
 primary key(store_id,year,month),check(jsonb_typeof(cells)='object' and octet_length(cells::text)<=5000000)
);
alter table fulfillment_private.order_formats enable row level security;
revoke all on fulfillment_private.order_formats from public,anon,authenticated;
do $migration$
begin
 execute replace(pg_get_functiondef('public.order_workspace(text,jsonb)'::regprocedure),'FUNCTION public.order_workspace','FUNCTION fulfillment_private.spreadsheet_workspace');
end $migration$;
revoke all on function fulfillment_private.spreadsheet_workspace(text,jsonb) from public,anon,authenticated;

create or replace function public.order_workspace(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; result jsonb; formats jsonb; row_item record; cell_item record; prop record; border_item record; edge_prop record; yr integer; mon integer;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active;
 if p.user_id is null or p.store_id is null or p.role::text not in ('staff','investor') then raise exception 'An active assigned store account is required' using errcode='42501';end if;
 if action='grid_commit' and payload ? 'formats' then
  if p.role::text<>'staff' then raise exception 'View-only access' using errcode='42501';end if;
  formats:=payload->'formats';
  if jsonb_typeof(formats) is distinct from 'object' or octet_length(formats::text)>5000000 then raise exception 'Invalid cell formatting';end if;
  for row_item in select * from jsonb_each(formats) loop
   if row_item.key !~ '^[1-9][0-9]{0,5}$' or row_item.key::integer>100000 or jsonb_typeof(row_item.value)<>'object' then raise exception 'Invalid formatting row';end if;
   for cell_item in select * from jsonb_each(row_item.value) loop
    if cell_item.key not in ('order_id','quantity','earning','purchase_id','supplier','note','platform','tracking','secondary_tracking','status','product_cost','shipping_cost','additional_cost','gross','margin','id','date') or jsonb_typeof(cell_item.value)<>'object' then raise exception 'Invalid formatting column';end if;
    for prop in select * from jsonb_each(cell_item.value) loop
     if prop.key='fontSize' then
      if jsonb_typeof(prop.value)<>'number' or (prop.value::text)::numeric not between 1 and 400 or (prop.value::text)::numeric<>trunc((prop.value::text)::numeric) then raise exception 'Invalid font size';end if;
     elsif prop.key in ('bold','italic') then
      if jsonb_typeof(prop.value)<>'boolean' then raise exception 'Invalid font style';end if;
     elsif prop.key in ('color','fill') then
      if jsonb_typeof(prop.value)<>'string' or (prop.value#>>'{}') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid color';end if;
     elsif prop.key='align' then
      if (prop.value#>>'{}') not in ('left','center','right') or jsonb_typeof(prop.value)<>'string' then raise exception 'Invalid alignment';end if;
     elsif prop.key='borders' then
      if jsonb_typeof(prop.value)<>'object' then raise exception 'Invalid borders';end if;
      for border_item in select * from jsonb_each(prop.value) loop
       if border_item.key not in ('top','right','bottom','left') or jsonb_typeof(border_item.value)<>'object' then raise exception 'Invalid border edge';end if;
       if border_item.value->>'style' is null or border_item.value->>'style' not in ('thin','medium','thick','dashed','dotted','double') or border_item.value->>'color' is null or (border_item.value->>'color') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid border style';end if;
       for edge_prop in select * from jsonb_each(border_item.value) loop
        if edge_prop.key not in ('style','color') then raise exception 'Unknown border property';end if;
       end loop;
      end loop;
     else raise exception 'Unknown format property';
     end if;
    end loop;
   end loop;
  end loop;
 end if;
 -- The existing validator/period lock remains authoritative; both writes commit together.
 result:=fulfillment_private.spreadsheet_workspace(action,payload);
 if action='grid_commit' and payload ? 'formats' then
  yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;
  insert into fulfillment_private.order_formats(store_id,year,month,cells) values(p.store_id,yr,mon,formats)
  on conflict(store_id,year,month) do update set cells=excluded.cells;
 elsif action='read' then
  select coalesce(jsonb_object_agg(month,
   case when p.role::text='staff' then cells else
    coalesce((select jsonb_object_agg(rr.key,coalesce((select jsonb_object_agg(cc.key,cc.value) from jsonb_each(rr.value) cc where cc.key in ('order_id','quantity','earning','status','product_cost','shipping_cost','additional_cost','gross','margin','date')),'{}'::jsonb)) from jsonb_each(cells) rr),'{}'::jsonb)
   end),'{}'::jsonb) into formats from fulfillment_private.order_formats where store_id=p.store_id and year=(payload->>'year')::integer;
  result:=result||jsonb_build_object('formats',formats);
 end if;
 return result;
end $$;
revoke all on function public.order_workspace(text,jsonb) from public,anon;
grant execute on function public.order_workspace(text,jsonb) to authenticated;
