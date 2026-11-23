-- Enable after deploying the authenticated due-refund-mail Edge Function.
select cron.schedule('fulfillment-due-refund-mail','* * * * *',
 'select fulfillment_private.due_refund_mail_dispatch()');
