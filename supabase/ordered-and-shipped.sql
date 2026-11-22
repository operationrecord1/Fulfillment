create or replace function fulfillment_private.normalize_order_status() returns trigger language plpgsql set search_path='' as $$
begin
 if lower(new.data->>'status')='processed' then new.data=jsonb_set(new.data,'{status}','"Ordered"'::jsonb); end if;
 return new;
end $$;
revoke all on function fulfillment_private.normalize_order_status() from public,anon,authenticated;
create trigger normalize_order_row_status before insert or update of data on fulfillment_private.order_rows for each row execute function fulfillment_private.normalize_order_status();
create trigger normalize_order_edit_status before insert or update of data on fulfillment_private.ebay_order_edits for each row execute function fulfillment_private.normalize_order_status();
update fulfillment_private.order_rows set data=jsonb_set(data,'{status}','"Ordered"'),revision=revision+1,updated_at=now() where lower(data->>'status')='processed';
update fulfillment_private.ebay_order_edits set data=jsonb_set(data,'{status}','"Ordered"'),revision=revision+1,updated_at=now() where lower(data->>'status')='processed';
update fulfillment_private.store_options set statuses=array(select distinct case when x='Processed' then 'Ordered' else x end from unnest(statuses||array['Ordered','Shipped']) x),revision=revision+1;
alter table fulfillment_private.store_options alter column statuses set default array['Pending','Ordered','Shipped','Delivered','Label Created','Cancelled','Refunded','OOS','Alert'];
