# Listing workspace — verified behavior

- Catalog: authenticated Trading API GetMyeBaySelling ActiveList, 200 items/page. Full scans stage under a fixed scan ID. Missing totals, changed totals, duplicate/count mismatches, and failed pages cannot remove active items.
- On validated completion, absent active IDs are marked catalog_present=false and removed from the Active list. Historical rows and order image snapshots remain available. Added/restored/removed IDs and selling-price changes are retained in the private change log.
- Baseline full scan every 30 minutes; existing listing notifications may request earlier reconciliation. This is eventual sync, not an instant guarantee.
- Analytics refresh target is every 12 hours after a complete traversal. Provider quotas may delay it. The displayed metrics are the provider's last-30-day report, not lifetime counters.
- Supplier ASIN/URL and raw buying price are editable in Edit Supplier. Expected cost = round(raw buying price * 1.08, 2). Expected profit = selling price - expected cost, before eBay fees.
- Selling price is the actual eBay value refreshed by catalog sync. Use the eBay Listing link to edit on eBay; there is no untested price-write endpoint.
- Last Sale comes from imported order creation dates; no date is fabricated when no imported sale is found.
- Missing order images are independently recovered with authenticated GetItem (3 items/batch, retry cooldown 24h), saved into listing records, and copied into immutable order presentation snapshots.
- Example: 237192310679 / B0B96DQH8V / raw cost 17.99 / cost incl. 8% 19.43 / selling price at verification 30.99 / estimated profit 11.56.
- Original failure: GraphQL sellerListingSearch returned HTTP 200 with RATE_LIMITED. The worker previously logged only HTTP 200 and backed off, leaving 2,993 active mirror rows.
