create or replace function fulfillment_private.sheets_profile_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; yr integer; name text;
begin
 if tg_op='DELETE' then
  update fulfillment_private.sheets_targets set active=false where employee_id=old.user_id;
  return old;
 end if;
 if new.role::text<>'staff' or not new.is_active then
  update fulfillment_private.sheets_targets set active=false where employee_id=new.user_id;
  return new;
 end if;
 select s.name into name from public.stores s where s.id=new.store_id;
 update fulfillment_private.sheets_targets set active=true,store_id=new.store_id,
 store_name=coalesce(name,nullif(new.display_name,''),'Employee') where employee_id=new.user_id;
 if not found then
  insert into fulfillment_private.sheets_targets(employee_id,store_id,store_name)
  values(new.user_id,new.store_id,coalesce(name,nullif(new.display_name,''),'Employee'));
 end if;
 for yr in select extract(year from now() at time zone 'Asia/Dhaka')::integer
 union select r.year from fulfillment_private.order_rows r where r.store_id=new.store_id
 union select j.year from fulfillment_private.sheets_jobs j where j.employee_id=new.user_id
 loop perform fulfillment_private.sheets_enqueue(new.user_id,yr);end loop;
 return new;
end $$;
