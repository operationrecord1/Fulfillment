create index refund_dirty_ready on fulfillment_private.refund_dirty(changed_at,store_id,order_id);
create index due_refund_mail_ready on fulfillment_private.due_refund_mail(next_attempt,created_at,id) where state='pending';
create index due_refund_mail_expired on fulfillment_private.due_refund_mail(lease_until) where state='sending';
