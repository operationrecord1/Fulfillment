-- Enable only after the worker deployment and successful live API checks.
select cron.schedule('fulfillment-ebay-sync','* * * * *','select fulfillment_private.ebay_dispatch()');
