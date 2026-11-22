create function public.ebay_store_records(target uuid,kind text,after_id text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and is_active and (role='admin' or (role='staff' and store_id=target))) then raise exception 'Store access required'; end if;
 if kind not in ('orders','listings','returns','transactions','traffic') then raise exception 'Unknown resource'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select external_id,data,updated_at from fulfillment_private.ebay_records where store_id=target and resource=kind and external_id>after_id order by external_id limit 50) r),'[]'::jsonb);
end $$;
revoke all on function public.ebay_store_records(uuid,text,text) from public,anon;
grant execute on function public.ebay_store_records(uuid,text,text) to authenticated;
