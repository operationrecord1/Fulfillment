alter table fulfillment_private.store_options add column if not exists platform_accounts jsonb not null default '[]'::jsonb;
update fulfillment_private.store_options s set platform_accounts=(select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'label',label,'name','','active',true,'aliases','[]'::jsonb)),'[]'::jsonb) from unnest(s.platforms) label) where platform_accounts='[]'::jsonb;
CREATE OR REPLACE FUNCTION fulfillment_private.order_workspace(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.profiles; r fulfillment_private.order_rows; e fulfillment_private.expenses;
 d jsonb; result jsonb; rows_data jsonb; opts jsonb; k text; n numeric; yr integer; mon integer; rid uuid; account_item jsonb; prior_account jsonb; account_list jsonb;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active;
 if p.user_id is null or p.store_id is null or p.role::text not in ('staff','investor') then
   raise exception 'An active assigned store account is required' using errcode='42501';
 end if;
 if action='read' then
   yr:=(payload->>'year')::integer;
   if yr not between 2000 and 2100 then raise exception 'Invalid year'; end if;
   with ordered as (
    select t.*,lag(position) over(partition by month order by position,id) previous_position,lag(data) over(partition by month order by position,id) previous
    from fulfillment_private.order_rows t where store_id=p.store_id and year=yr and deleted_at is null
   ), numbered as (
    select *,sum(case when position=previous_position+1 and ((nullif(data->>'order_id','') is not null and data->>'order_id'=previous->>'order_id')
      or (nullif(data->>'purchase_id','') is not null and data->>'purchase_id'=previous->>'purchase_id') ) then 0 else 1 end)
      over(partition by month order by position,id) group_no from ordered
   ), grouped as (
    select *,month::text||'-'||group_no::text group_key,
    sum(nullif(data->>'earning','')::numeric) over(partition by month,group_no) rev,
    sum(nullif(data->>'product_cost','')::numeric) over(partition by month,group_no) cost,
    sum(coalesce(nullif(data->>'shipping_cost','')::numeric,0)+coalesce(nullif(data->>'additional_cost','')::numeric,0)) over(partition by month,group_no) other_cost
    from numbered
   ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_number',display_number::text,'month',month,'year',year,'position',position,'revision',revision,
       'group_key',group_key,'group_profit',case when rev is not null and cost is not null then rev-cost-other_cost end,
       'group_margin',case when rev<>0 and cost is not null then greatest(-100,least(100,(rev-cost-other_cost)/rev*100)) end,
       'data',case when p.role::text='staff' then data else jsonb_build_object(
         'order_id',data->'order_id','order_url',data->'order_url','quantity',data->'quantity','earning',data->'earning',
         'status',data->'status','product_cost',data->'product_cost','shipping_cost',data->'shipping_cost',
         'additional_cost',data->'additional_cost','date',data->'date','platform',data->'platform','tracking',data->'tracking','secondary_tracking',data->'secondary_tracking') end) order by month,position,id),'[]'::jsonb)
     into rows_data from grouped;
   select jsonb_build_object('platforms',platforms,'revision',revision,'tax_percentage',tax_percentage,'statuses',statuses,'logo',logo,'monthly_targets',monthly_targets,'platform_colors',platform_colors,'platform_text_colors',platform_text_colors,'platform_accounts',platform_accounts) into opts from fulfillment_private.store_options where store_id=p.store_id; if p.role::text='investor' then opts:=opts-'monthly_targets'; end if;
   return jsonb_build_object('rows',rows_data,'options',coalesce(opts,'{"platforms":["Amazon"],"revision":0,"tax_percentage":15}'::jsonb),
     'store_name',(select name from public.stores where id=p.store_id),
     'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',case when p.role::text='staff' then name else 'Store expense' end,
      'amount',amount,'date',date,'type',type,'revision',revision,'created_at',created_at,'receipt_url',case when p.role::text='staff' then receipt_url else '' end,'note',case when p.role::text='staff' then note else '' end) order by date,id) from fulfillment_private.expenses where store_id=p.store_id and deleted_at is null and extract(year from date)=yr),'[]'::jsonb));
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
   if length(d->>'status')>60 or length(d->>'platform')>60 then raise exception 'Maximum 60 characters for dropdown values';end if;
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



 elsif action='monthly_target' then
   yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;n:=(payload->>'amount')::numeric;
   if yr is null or yr not between 2000 and 2100 or mon is null or mon not between 0 and 12 or n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000000 then raise exception 'Invalid monthly target';end if;
   insert into fulfillment_private.store_options(store_id,revision) values(p.store_id,0) on conflict(store_id) do nothing;
   update fulfillment_private.store_options set monthly_targets=jsonb_set(monthly_targets,array[yr::text||'-'||lpad(mon::text,2,'0')],to_jsonb(round(n,2))),revision=revision+1
    where store_id=p.store_id and revision=(payload->>'revision')::integer returning revision into n;
   if not found then raise exception 'Settings changed. Reload before saving target';end if;
   return (select jsonb_build_object('monthly_targets',monthly_targets,'revision',revision) from fulfillment_private.store_options where store_id=p.store_id);
 elsif action='rename_store' then

   if p.role::text<>'staff' then raise exception 'Only store staff can change the store name' using errcode='42501'; end if;
   if jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 2 and 120 then raise exception 'Store name must contain 2 to 120 characters'; end if;
   begin
     update public.stores set name=btrim(payload->>'name')
       where id=p.store_id and name=payload->>'previous_name';
   exception when unique_violation then raise exception 'This store name is already in use'; end;
   if not found then raise exception 'Store name changed. Reload before saving'; end if;
   return jsonb_build_object('name',btrim(payload->>'name'));
 elsif action in ('platforms','workspace_settings') then

   if payload->'platforms' is null or jsonb_typeof(payload->'platforms')<>'array' or jsonb_array_length(payload->'platforms')>50 then raise exception 'Maximum 50 platforms';end if;
   if exists(select 1 from jsonb_array_elements(payload->'platforms') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 60) then raise exception 'Invalid platform name';end if;
   if payload ? 'platform_accounts' then
    if jsonb_typeof(payload->'platform_accounts') is distinct from 'array' or jsonb_array_length(payload->'platform_accounts')>50 then raise exception 'Maximum 50 accounts'; end if;
    account_list:='[]'::jsonb;
    for account_item in select value from jsonb_array_elements(payload->'platform_accounts') loop
      if jsonb_typeof(account_item->'id') is distinct from 'string' or (account_item->>'id') !~ '^[0-9a-f-]{36}$' or jsonb_typeof(account_item->'label') is distinct from 'string' or length(btrim(account_item->>'label')) not between 1 and 60 or jsonb_typeof(account_item->'name') is distinct from 'string' or length(btrim(account_item->>'name'))>120 then raise exception 'Invalid account label or name'; end if;
      if exists(select 1 from jsonb_array_elements(account_list) a where a->>'id'=account_item->>'id' or lower(a->>'label')=lower(btrim(account_item->>'label'))) then raise exception 'Duplicate account label or ID'; end if;
      select a into prior_account from fulfillment_private.store_options s cross join lateral jsonb_array_elements(s.platform_accounts) a where s.store_id=p.store_id and a->>'id'=account_item->>'id';
      account_list:=account_list||jsonb_build_array(jsonb_build_object('id',account_item->>'id','label',btrim(account_item->>'label'),'name',btrim(account_item->>'name'),'active',true,'aliases',coalesce(prior_account->'aliases','[]'::jsonb)||case when prior_account is not null and prior_account->>'label'<>btrim(account_item->>'label') then jsonb_build_array(prior_account->>'label') else '[]'::jsonb end));
    end loop;
    if (select coalesce(jsonb_agg(a->>'label'),'[]'::jsonb) from jsonb_array_elements(account_list) a) <> payload->'platforms' then raise exception 'Account labels must match platform options'; end if;
    account_list:=account_list||coalesce((select jsonb_agg(a||'{"active":false}'::jsonb) from fulfillment_private.store_options s cross join lateral jsonb_array_elements(s.platform_accounts) a where s.store_id=p.store_id and not exists(select 1 from jsonb_array_elements(account_list) x where x->>'id'=a->>'id')),'[]'::jsonb);
   end if;
   n:=coalesce((select tax_percentage from fulfillment_private.store_options where store_id=p.store_id),15);
   if action='workspace_settings' then
     if nullif(payload->>'tax_percentage','') is null then raise exception 'Enter a tax percentage';end if;
     n:=(payload->>'tax_percentage')::numeric;
     if n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000000 then raise exception 'Enter a valid non-negative tax percentage';end if;
   end if;

   if payload ? 'statuses' then
     if jsonb_typeof(payload->'statuses')<>'array' or jsonb_array_length(payload->'statuses')>50 then raise exception 'Maximum 50 order statuses'; end if;
     if exists(select 1 from jsonb_array_elements(payload->'statuses') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 60) then raise exception 'Invalid status name'; end if;
   end if;
   if payload ? 'platform_colors' then
if jsonb_typeof(payload->'platform_colors') is distinct from 'object' or octet_length((payload->'platform_colors')::text)>10000 then raise exception 'Invalid platform colors';end if;
if exists(select 1 from jsonb_each_text(payload->'platform_colors') c where length(c.key) not between 1 and 60 or c.value !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Invalid platform color';end if;
end if;
if payload ? 'platform_text_colors' then
if jsonb_typeof(payload->'platform_text_colors') is distinct from 'object' or octet_length((payload->'platform_text_colors')::text)>10000 then raise exception 'Invalid platform colors';end if;
if exists(select 1 from jsonb_each_text(payload->'platform_text_colors') c where length(c.key) not between 1 and 60 or c.value !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Invalid platform color';end if;
end if;
   if payload ? 'logo' and (jsonb_typeof(payload->'logo')<>'string' or length(payload->>'logo')>100000 or ((payload->>'logo')<>'' and (payload->>'logo') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')) then raise exception 'Invalid store logo'; end if;
   insert into fulfillment_private.store_options(store_id,platforms,tax_percentage)

   values(p.store_id,array(select value from (select btrim(x.value) value,min(x.ordinality) seq from jsonb_array_elements_text(payload->'platforms') with ordinality x(value,ordinality) group by btrim(x.value)) labels order by seq),n)
   on conflict(store_id) do update set platforms=excluded.platforms,tax_percentage=excluded.tax_percentage,revision=fulfillment_private.store_options.revision+1
   where fulfillment_private.store_options.revision=(payload->>'revision')::integer;
   if not found then raise exception 'Settings changed. Refresh before saving';end if;

   update fulfillment_private.store_options set
     platform_accounts=case when payload ? 'platform_accounts' then account_list else platform_accounts end,
     statuses=case when payload ? 'statuses' then array(select distinct btrim(value) from jsonb_array_elements_text(payload->'statuses')) else statuses end,
     platform_colors=case when payload ? 'platform_colors' then payload->'platform_colors' else platform_colors end,
platform_text_colors=case when payload ? 'platform_text_colors' then payload->'platform_text_colors' else platform_text_colors end,
     logo=case when payload ? 'logo' then payload->>'logo' else logo end
     where store_id=p.store_id;
   return (select jsonb_build_object('platforms',platforms,'tax_percentage',tax_percentage,'revision',revision,'statuses',statuses,'logo',logo,'monthly_targets',monthly_targets,'platform_colors',platform_colors,'platform_text_colors',platform_text_colors,'platform_accounts',platform_accounts) from fulfillment_private.store_options where store_id=p.store_id);
 elsif action='save_expense' then
   if length(btrim(coalesce(payload->>'name',''))) not between 1 and 120 then raise exception 'Enter an expense name';end if;
   if coalesce(payload->>'type','') not in ('Subscription','Software','Operation','Other') then raise exception 'Choose an expense type';end if;
   if nullif(payload->>'amount','') is null or (payload->>'amount')::numeric<=0 or (payload->>'amount')::numeric>1000000000 or (payload->>'amount')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a valid expense amount';end if;
   if nullif(payload->>'date','') is null or extract(year from (payload->>'date')::date) not between 2000 and 2100 then raise exception 'Choose a valid date';end if;
   if length(coalesce(payload->>'receipt_url',''))>2000 or (coalesce(payload->>'receipt_url','')<>'' and (payload->>'receipt_url') !~* '^https?://[^[:space:]/]+[^[:space:]]*$') then raise exception 'Enter a valid http or https receipt link';end if;
   if length(coalesce(payload->>'note',''))>2000 then raise exception 'Note must be 2000 characters or fewer';end if;
   if nullif(payload->>'id','') is null then
     insert into fulfillment_private.expenses(store_id,name,amount,date,type,receipt_url,note)
     values(p.store_id,btrim(payload->>'name'),(payload->>'amount')::numeric,(payload->>'date')::date,payload->>'type',coalesce(payload->>'receipt_url',''),coalesce(payload->>'note','')) returning * into e;
   else
     update fulfillment_private.expenses set name=btrim(payload->>'name'),amount=(payload->>'amount')::numeric,date=(payload->>'date')::date,type=payload->>'type',receipt_url=coalesce(payload->>'receipt_url',''),note=coalesce(payload->>'note',''),deleted_at=null,revision=revision+1
     where id=(payload->>'id')::uuid and store_id=p.store_id and revision=(payload->>'revision')::integer returning * into e;
     if not found then raise exception 'Expense changed. Refresh before saving';end if;
   end if;
   return to_jsonb(e)-'store_id';
 elsif action='delete_expense' then
   update fulfillment_private.expenses set deleted_at=clock_timestamp(),revision=revision+1
   where id=(payload->>'id')::uuid and store_id=p.store_id and revision=(payload->>'revision')::integer and deleted_at is null returning * into e;
   if not found then raise exception 'Expense changed. Refresh before deleting';end if;
   return to_jsonb(e)-'store_id';
 end if;
 raise exception 'Unknown workspace action';
end $function$
;
CREATE OR REPLACE FUNCTION public.order_workspace(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.profiles; result jsonb; formats jsonb; row_item record; cell_item record; prop record; border_item record; edge_prop record; yr integer; mon integer;
begin
 select * into p from public.profiles where user_id=auth.uid() and is_active;
 if p.user_id is null or p.store_id is null or p.role::text not in ('staff','investor') then raise exception 'An active assigned store account is required' using errcode='42501';end if;
 if action='history' then
if p.role::text<>'staff' then raise exception 'Employee access required' using errcode='42501';end if;
return coalesce((select jsonb_agg(x) from (select h.changed_at,h.old_data,h.new_data,coalesce(pr.display_name,'Store user') as actor from fulfillment_private.order_edit_history h left join public.profiles pr on pr.user_id=h.actor where h.store_id=p.store_id and h.row_id=(payload->>'row_id')::uuid order by h.id desc limit 100) x),'[]'::jsonb);
end if;
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
     elsif prop.key='cellNote' then
 if jsonb_typeof(prop.value)<>'string' or length(prop.value#>>'{}')>10000 then raise exception 'Invalid cell note';end if;
 elsif prop.key='href' then
 if jsonb_typeof(prop.value)<>'string' or length(prop.value#>>'{}')>2000 or ((prop.value#>>'{}')<>'' and (prop.value#>>'{}') !~* '^https?://[^[:space:]]+$') then raise exception 'Invalid hyperlink';end if;
 elsif prop.key='options' then
 if cell_item.key not in ('platform','status') or jsonb_typeof(prop.value)<>'array' then raise exception 'Invalid cell options';end if;
 if jsonb_array_length(prop.value)>50 or exists(select 1 from jsonb_array_elements(prop.value) v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 60) then raise exception 'Invalid cell option';end if;
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
 if action='history' then
if p.role::text<>'staff' then raise exception 'Employee access required' using errcode='42501';end if;
return coalesce((select jsonb_agg(x) from (select h.changed_at,h.old_data,h.new_data,coalesce(pr.display_name,'Store user') as actor from fulfillment_private.order_edit_history h left join public.profiles pr on pr.user_id=h.actor where h.store_id=p.store_id and h.row_id=(payload->>'row_id')::uuid order by h.id desc limit 100) x),'[]'::jsonb);
end if;
 if action='grid_commit' and payload ? 'formats' then
  yr:=(payload->>'year')::integer;mon:=(payload->>'month')::integer;
  insert into fulfillment_private.order_formats(store_id,year,month,cells) values(p.store_id,yr,mon,formats)
  on conflict(store_id,year,month) do update set cells=excluded.cells;
 elsif action='read' then
  select coalesce(jsonb_object_agg(month,
   case when p.role::text='staff' then cells else
    coalesce((select jsonb_object_agg(rr.key,coalesce((select jsonb_object_agg(cc.key,cc.value) from jsonb_each(rr.value) cc where cc.key in ('order_id','quantity','earning','platform','tracking','secondary_tracking','id','status','product_cost','shipping_cost','additional_cost','gross','margin','date')),'{}'::jsonb)) from jsonb_each(cells) rr),'{}'::jsonb)
   end),'{}'::jsonb) into formats from fulfillment_private.order_formats where store_id=p.store_id and year=(payload->>'year')::integer;
  result:=result||jsonb_build_object('formats',formats);
 end if;
 if action='read' and p.role::text='investor' then
  result:=jsonb_set(result,'{rows}',coalesce((select jsonb_agg(jsonb_set(item,'{data}',(item->'data')-'platform')) from jsonb_array_elements(result->'rows') item),'[]'::jsonb));
  result:=jsonb_set(result,'{options}',coalesce(result->'options','{}'::jsonb)-'platforms'-'platform_colors'-'platform_text_colors'-'platform_accounts'-'monthly_targets');
  result:=jsonb_set(result,'{formats}',coalesce((select jsonb_object_agg(m.key,coalesce((select jsonb_object_agg(r.key,r.value-'platform') from jsonb_each(m.value) r),'{}'::jsonb)) from jsonb_each(coalesce(result->'formats','{}'::jsonb)) m),'{}'::jsonb));
 end if;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.ebay_orders_period_page(target uuid, kind text DEFAULT 'orders'::text, query_text text DEFAULT ''::text, status_filter text DEFAULT ''::text, page_number integer DEFAULT 1, page_size integer DEFAULT 25, period_year integer DEFAULT 2026, period_month integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare period_start date; period_end date; elapsed_days integer; zone text; lower_date text; upper_date text; result jsonb; n integer:=greatest(1,page_number); size integer:=least(200,greatest(10,page_size));
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 select reporting_timezone into zone from fulfillment_private.ebay_connections where store_id=target;zone=coalesce(zone,'America/Los_Angeles');
 if kind<>'orders' or period_year not between 2000 and 2100 or period_month not between 0 and 12 then raise exception 'Invalid order period'; end if;
 lower_date=to_char((make_date(period_year,greatest(1,period_month),1)::timestamp at time zone zone) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 upper_date=to_char(((make_date(period_year,greatest(1,period_month),1)+case when period_month=0 then interval '1 year' else interval '1 month' end) at time zone zone) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 period_start=make_date(period_year,greatest(1,period_month),1);
 period_end=(period_start+case when period_month=0 then interval '1 year' else interval '1 month' end)::date;
 elapsed_days=greatest(0,least(period_end,(now() at time zone zone)::date+1)-period_start);
 with records as (
  select r.external_id,r.data,r.updated_at,
   case when kind='listings' then case when r.data->>'catalog_present'='false' then 'UNAVAILABLE' else r.data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}' end else case when r.data#>>'{cancelStatus,cancelState}'='CANCELED' then 'CANCELLED' else r.data->>'orderFulfillmentStatus' end end as state,
   case when kind='listings' then r.data#>>'{listing,sellerProduct,title}' else (select string_agg(x->>'title',' ') from jsonb_array_elements(r.data->'lineItems') x) end as title,
   case when kind='orders' then r.data->>'creationDate' else r.data#>>'{listing,listingTerms,lifecycleTerms,startAt}' end as created
  from fulfillment_private.ebay_records r where r.store_id=target and r.resource=kind and r.data->>'creationDate'>=lower_date and r.data->>'creationDate'<upper_date
 ), financials as (
 select r.external_id,
 case when count(*) filter(where t.data->>'transactionType'='SALE')>0
 and count(distinct t.data#>>'{amount,currency}')=1
 and bool_and(t.data->>'bookingEntry' in ('CREDIT','DEBIT') and coalesce(t.data#>>'{amount,value}','') ~ '^-?[0-9]+([.][0-9]+)?$' and t.data->>'transactionType' in ('SALE','REFUND','CREDIT','DISPUTE','NON_SALE_CHARGE','SHIPPING_LABEL','ADJUSTMENT'))
 then sum(case when t.data->>'bookingEntry'='DEBIT' then -1 else 1 end * case when coalesce(t.data#>>'{amount,value}','') ~ '^-?[0-9]+([.][0-9]+)?$' then (t.data#>>'{amount,value}')::numeric end) end as earning,
 min(t.data#>>'{amount,currency}') currency,max(t.updated_at) updated_at
 from records r left join fulfillment_private.ebay_records t on t.store_id=target and t.resource='transactions' and fulfillment_private.ebay_transaction_order_id(t.data)=r.external_id and not fulfillment_private.ebay_is_temporary_hold(t.data)
 group by r.external_id
 ),
 workspace_costs as (
 select btrim(o.data->>'order_id') order_id,
 sum(case when o.data->>'product_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'product_cost')::numeric end) cost,
 sum(case when o.data->>'shipping_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'shipping_cost')::numeric end) shipping,
 sum(case when o.data->>'additional_cost' ~ '^-?[0-9]+([.][0-9]+)?$' then (o.data->>'additional_cost')::numeric end) additional,
 bool_or(coalesce(o.data->>'purchase_id','') ~ '[^[:space:]]') has_buy_id,
 (array_agg(o.data->>'status' order by o.year,o.month,o.position) filter(where nullif(o.data->>'status','') is not null))[1] manual_status
 from fulfillment_private.order_rows o join records r on btrim(o.data->>'order_id')=r.external_id
 where o.store_id=target and o.deleted_at is null group by 1
 ), order_amounts as (
 select r.external_id,((r.created)::timestamptz at time zone zone)::date metric_date,
 case when e.data ? 'purchase_id' then coalesce(e.data->>'purchase_id','') ~ '[^[:space:]]' else coalesce(w.has_buy_id,false) end has_buy_id,
 (case when e.data ? 'buy_price' then nullif(e.data->>'buy_price','')::numeric else w.cost end) is not null
 or (case when e.data ? 'shipping_cost' then nullif(e.data->>'shipping_cost','')::numeric else w.shipping end) is not null
 or (case when e.data ? 'additional_cost' then nullif(e.data->>'additional_cost','')::numeric else w.additional end) is not null has_recorded_cost,
 case when e.data ? 'status' then e.data->>'status' else w.manual_status end manual_status,
 r.data->>'orderPaymentStatus' payment_status,
 coalesce(r.data#>>'{cancelStatus,cancelState}'='CANCELED',false) cancelled,
 case when f.currency='USD' then f.earning end earning,
 case when e.data ? 'buy_price' then nullif(e.data->>'buy_price','')::numeric else w.cost end cost,
 coalesce(case when e.data ? 'shipping_cost' then nullif(e.data->>'shipping_cost','')::numeric else w.shipping end,0) shipping,
 coalesce(case when e.data ? 'additional_cost' then nullif(e.data->>'additional_cost','')::numeric else w.additional end,0) additional,
 case when coalesce((r.data#>>'{pricingSummary,total,value}')::numeric,0)<12 then 0 when (r.data#>>'{pricingSummary,total,value}')::numeric<30 then 1 else 2 end size_group
 from records r join financials f on f.external_id=r.external_id
 left join workspace_costs w on w.order_id=r.external_id
 left join fulfillment_private.ebay_order_edits e on e.store_id=target and e.order_id=r.external_id
 ), order_classifications as (
 select *,case when manual_status in ('Alert','OOS','Refunded') then manual_status
  when payment_status='FULLY_REFUNDED' then 'Refunded'
  when cancelled then 'Cancelled' end metric_status
 from order_amounts
 ), order_metrics as (
 select *,round(earning*100) revenue_cents,round(cost*100) cost_cents,
 round((earning-cost-shipping-additional)*100) profit_cents,
 earning is not null and (earning<=0 or has_buy_id or has_recorded_cost or coalesce(metric_status='Refunded',false) or cancelled) is_processed
 from order_classifications
 ), metric_days as (
 select metric_date,count(*) count,coalesce(sum(revenue_cents),0) revenue,
 coalesce(sum(revenue_cents) filter(where is_processed),0) processed_revenue,
 coalesce(sum(revenue_cents) filter(where not is_processed),0) unprocessed_revenue,
 coalesce(sum(cost_cents),0) cost,
 coalesce(sum(round(shipping*100)),0) shipping,coalesce(sum(round(additional*100)),0) additional,
 coalesce(sum(profit_cents),0) gross,count(*) filter(where earning is null and not cancelled) pending_earnings,
 count(*) filter(where cost is null and not cancelled and not (not has_buy_id and coalesce(metric_status='Refunded',false))) pending_cost,
 count(*) filter(where cost is not null and not cancelled and not coalesce(metric_status='Refunded',false)) gross_cost_count,
 count(*) filter(where cost is null and not cancelled and not coalesce(metric_status='Refunded',false)) gross_pending_cost,
 count(*) filter(where profit_cents is not null) profit_count,
 count(*) filter(where profit_cents is not null and earning<>0) margin_count,
 coalesce(sum(greatest(-100,least(100,profit_cents/nullif(earning,0)))) filter(where profit_cents is not null and earning<>0),0) margin_sum
 from order_metrics group by metric_date
 ), filtered as (select * from records where (status_filter='' or state=status_filter) and (query_text='' or external_id ilike '%'||left(query_text,160)||'%' or title ilike '%'||left(query_text,160)||'%' or data->'buyer'->>'username' ilike '%'||left(query_text,160)||'%')),
 ready as (select r.* from filtered r),
 paged as (select * from ready order by created desc nulls last,external_id desc limit size offset (n-1)*size)
 select jsonb_build_object('timezone',zone,'imported_total',(select count(*) from fulfillment_private.ebay_records where store_id=target and resource='orders'),'period_count',(select count(*) from records),'size_counts',jsonb_build_array((select count(*) from records where coalesce((data#>>'{pricingSummary,total,value}')::numeric,0)<12),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=12 and (data#>>'{pricingSummary,total,value}')::numeric<30),(select count(*) from records where (data#>>'{pricingSummary,total,value}')::numeric>=30)),'history',(select jsonb_build_object('complete',last_success is not null,'error',last_error,'from',coverage_from) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='orders_history'),'total',(select count(*) from ready),'pending_total',(select count(*) from filtered r join financials f on f.external_id=r.external_id where f.earning is null),'counts',(select coalesce(jsonb_object_agg(state,c),'{}') from (select coalesce(state,'UNKNOWN') state,count(*) c from records group by 1) c),
 'average_daily_orders',case when elapsed_days>0 then (select count(*)::numeric/elapsed_days from records) else 0 end,
 'elapsed_days',elapsed_days,
 'daily_counts',(select coalesce(jsonb_object_agg(order_day,c),'{}') from (select ((data->>'creationDate')::timestamptz at time zone zone)::date as order_day,count(*) c from records group by 1) daily),
 'earnings_summary',(select jsonb_build_object('ready_count',count(earning),'pending_count',count(*)-count(earning),'currency',min(currency),'average',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(avg(earning),0) end,'total',case when count(earning)=count(*) and count(distinct currency)<=1 then coalesce(sum(earning),0) end) from financials),
 'platform_options',(select jsonb_build_object('platforms',platforms,'platform_colors',platform_colors,'platform_text_colors',platform_text_colors,'platform_accounts',platform_accounts) from fulfillment_private.store_options where store_id=target),'order_metrics',jsonb_build_object('year',period_year,'month',period_month,'days',(select coalesce(jsonb_agg(to_jsonb(md) order by metric_date),'[]'::jsonb) from metric_days md),'sizes',(select coalesce(jsonb_agg(jsonb_build_object('index',size_group,'count',c,'profit',profit) order by size_group),'[]'::jsonb) from (select size_group,count(*) c,coalesce(sum(profit_cents),0) profit from order_metrics group by size_group) s)),
 'finance_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='transactions'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.external_id,'data',p.data,'delivery',(select dt.data from fulfillment_private.ebay_records dt where dt.store_id=target and dt.resource='delivery_tracking' and dt.external_id=p.external_id),'returns',(select coalesce(jsonb_agg(jsonb_build_object('state',rr.data->>'state','tracking',rr.data->'_returnTracking')),'[]'::jsonb) from fulfillment_private.ebay_records rr where rr.store_id=target and rr.resource='returns' and rr.data->>'orderId'=p.external_id),'edit',(select jsonb_build_object('data',e.data,'revision',e.revision) from fulfillment_private.ebay_order_edits e where e.store_id=target and e.order_id=p.external_id),'earnings',(select jsonb_build_object('value',f.earning,'currency',f.currency,'updated_at',f.updated_at) from financials f where f.external_id=p.external_id),'updated_at',p.updated_at,'workspace_rows',case when kind='orders' then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'display_number',o.display_number::text,'year',o.year,'month',o.month,'position',o.position,'data',o.data) order by o.year,o.month,o.position) from fulfillment_private.order_rows o where o.store_id=target and o.deleted_at is null and btrim(o.data->>'order_id')=p.external_id),'[]'::jsonb) else '[]'::jsonb end,'image',case when kind='orders' then p.data#>>'{_orderSnapshot,image}' else p.data#>>'{listing,sellerProduct,images,0,ebayImageUrl}' end,'traffic',case when kind='listings' then (select t.data from fulfillment_private.ebay_records t where t.store_id=target and t.resource='listing_traffic' and t.external_id=p.external_id) else null end) order by p.created desc nulls last,p.external_id desc) from paged p),'[]'),
 'sync',(select jsonb_build_object('last_success',last_success,'error',last_error,'running',coalesce(lease_until>now(),false) or reset_requested or cursor<>'{}'::jsonb,'requested_at',requested_at) from fulfillment_private.ebay_sync_jobs where store_id=target and resource=kind),
 'analytics_sync',(select jsonb_build_object('last_success',last_success,'error',last_error) from fulfillment_private.ebay_sync_jobs where store_id=target and resource='listing_traffic'),
 'events',jsonb_build_object('enabled',(select count(*)=4 from fulfillment_private.ebay_notification_subscriptions where store_id=target and status='ENABLED' and topic in ('LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY')),'pending',(select count(*) from fulfillment_private.ebay_notification_inbox where store_id=target and disposition='pending'),'last_received',(select max(received_at) from fulfillment_private.ebay_notification_inbox where store_id=target),'last_processed',(select max(processed_at) from fulfillment_private.ebay_notification_inbox where store_id=target)),
 'seller',(select username from fulfillment_private.ebay_connections where store_id=target),'store',(select name from public.stores where id=target)) into result;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.ebay_order_edit_save(target uuid, order_id text, changes jsonb, expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; k text; v jsonb; account_item jsonb; account_value text;
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if not exists(select 1 from fulfillment_private.ebay_records r where r.store_id=target and r.resource='orders' and r.external_id=order_id) then raise exception 'Order not found'; end if;
 if jsonb_typeof(changes)<>'object' or octet_length(changes::text)>16000 then raise exception 'Invalid changes'; end if;
 for k,v in select * from jsonb_each(changes) loop
  if k not in ('status','tags','note','purchase_id','buyer_account','platform','account_id','buy_price','shipping_cost','additional_cost','tracking','carrier','carrier_2','carrier_3','supplier','buy_url','first_name','last_name','address1','address2','city','state','zip','country','phone') then raise exception 'Unsupported field'; end if;
  if k in ('buy_price','shipping_cost','additional_cost') then
   if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v::text)::numeric<case when k='buy_price' then -999999999 else 0 end or (v::text)::numeric>999999999 or round((v::text)::numeric,2)<>(v::text)::numeric) then raise exception 'Invalid buying price'; end if;
  elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'Invalid text field'; end if;
 end loop;

 if changes ? 'platform' or changes ? 'buyer_account' or changes ? 'account_id' then
  if changes ? 'platform' and changes ? 'buyer_account' and changes->>'platform'<>changes->>'buyer_account' then raise exception 'Account selections must match'; end if;
  account_value:=btrim(coalesce(changes->>'platform',changes->>'buyer_account',''));
  if length(account_value)>60 then raise exception 'Maximum 60 characters for account labels'; end if;
  if coalesce(changes->>'account_id','')<>'' then
    select a into account_item from fulfillment_private.store_options s cross join lateral jsonb_array_elements(s.platform_accounts) a where s.store_id=target and a->>'id'=changes->>'account_id' and coalesce((a->>'active')::boolean,true);
    if account_item is null then raise exception 'Account option changed. Reopen the order and select again.'; end if;
  elsif account_value<>'' then
    select a into account_item from fulfillment_private.store_options s cross join lateral jsonb_array_elements(s.platform_accounts) a where s.store_id=target and lower(a->>'label')=lower(account_value) and coalesce((a->>'active')::boolean,true);
  end if;
  changes:=changes||jsonb_build_object('platform',coalesce(account_item->>'label',account_value),'buyer_account',coalesce(account_item->>'label',account_value),'account_id',coalesce(account_item->>'id',''));
 end if;
 if changes ? 'supplier' and changes->>'supplier' not in ('Amazon','AliExpress','Alibaba') then raise exception 'Invalid supplier'; end if;

 if changes ? 'status' and changes->>'status' not in ('','Pending','Due Refund','Ordered','Processed','Shipped','Delivered','Cancelled','Refunded','OOS','Alert','Label Created') then raise exception 'Invalid status'; end if;
 if changes ? 'carrier' and changes->>'carrier' not in ('','Amazon','USPS','UPS','DHL','FedEx','Other') then raise exception 'Invalid carrier'; end if;
 for k in select unnest(array['carrier_2','carrier_3']) loop
 if changes ? k and changes->>k not in ('','Amazon','USPS','UPS','DHL','FedEx','Other') then raise exception 'Invalid carrier'; end if;
 end loop;
 if changes ? 'tracking' and cardinality(regexp_split_to_array(btrim(changes->>'tracking'), E'\\n'))>3 then raise exception 'Maximum three tracking IDs are allowed'; end if;
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
end $function$
;

do $patch$ declare d text; begin d:=pg_get_functiondef('public.ebay_workspace_revision(uuid)'::regprocedure);if position('store_options' in d)=0 then d:=replace(d,'''0'');','''0'')||'':''||coalesce((select revision::text from fulfillment_private.store_options where store_id=target),''0'');');execute d;end if;end $patch$;
