do $$
declare source text;
begin
 source:=pg_get_functiondef('public.ebay_order_edit_save(uuid,text,jsonb,integer)'::regprocedure);
 source:=replace(source,'''Pending'',''Ordered'',''Processed''','''Pending'',''Due Refund'',''Ordered'',''Processed''');
 execute source;
end $$;
update fulfillment_private.store_options set statuses=array_append(statuses,'Due Refund'),revision=revision+1 where not ('Due Refund'=any(statuses));
alter table fulfillment_private.store_options alter column statuses set default array['Pending','Ordered','Shipped','Delivered','Label Created','Cancelled','Due Refund','Refunded','OOS','Alert'];
