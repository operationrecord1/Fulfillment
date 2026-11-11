begin;
alter table fulfillment_private.expenses add column if not exists created_at timestamptz not null default clock_timestamp();
alter table fulfillment_private.expenses add column if not exists receipt_url text not null default '';
alter table fulfillment_private.expenses add column if not exists note text not null default '';
alter table fulfillment_private.expenses add column if not exists deleted_at timestamptz;
do $update$
declare original text; updated text; start_at integer; end_at integer;
begin
 original:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
 updated:=replace(original,'''amount'',amount,''date'',date,''type'',type,''revision'',revision) order by date,id)',
 '''amount'',amount,''date'',date,''type'',type,''revision'',revision,''created_at'',created_at,''receipt_url'',case when p.role::text=''staff'' then receipt_url else '''' end,''note'',case when p.role::text=''staff'' then note else '''' end) order by date,id)');
 if updated=original then raise exception 'Expense read anchor changed';end if;
 updated:=replace(updated,'from fulfillment_private.expenses where store_id=p.store_id and extract(year from date)=yr','from fulfillment_private.expenses where store_id=p.store_id and deleted_at is null and extract(year from date)=yr');
 start_at:=strpos(updated,' elsif action=''save_expense'' then');end_at:=strpos(updated,' raise exception ''Unknown workspace action'';');
 if start_at=0 or end_at<start_at then raise exception 'Expense action anchor changed';end if;
 updated:=substr(updated,1,start_at-1)||$actions$
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
$actions$||substr(updated,end_at);
 execute updated;
end $update$;
commit;
