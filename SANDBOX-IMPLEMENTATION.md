# eBay Sandbox workspace

## Implemented and deployed
- Orders, Listings, Workflow Tests, Connection routes; selected subpage survives reload.
- Real authenticated Sandbox API gateway, isolated private tables and encrypted Vault credentials. No production token/data fallback.
- Seller identity verified with Sandbox Trading GetUser. Connected seller: testuser_crestonglobaltest.
- Fulfillment Orders reads with 50-record pages and confirmed API total (default last 90 days).
- Active listings via GetMyeBaySelling with 50-record pages. An omitted ActiveList is shown as records absent/count unavailable, not invented zero.
- On-screen 30-second refresh while visible, explicit manual refresh and last-check timestamp. This is polling, not a webhook delivery guarantee.
- Order-specific tracking: fresh check, one shipment only, cancellation/payment eligibility, atomic duplicate lock, uncertain writes block retry, read-back confirms tracking.
- Fixed-price, nonvariation listing price/quantity updates with seller verification and read-back. Unknown results block another write until confirmed by Check listing.
- Manual Sandbox buyer messaging tied to the API order buyer and item. Same message/order deduplicated. API acceptance is not proof of receipt.
- OAuth config, one-use state callback and refresh-token implementation. Sandbox Client Secret is in Vault. Sandbox RuName accepted URL points to the Sandbox callback.
- Active connection now uses refreshable OAuth. The website Verify token refresh action successfully exchanged the refresh token and verified the resulting Sandbox seller identity on 2026-11-27.
- API activity log (50 latest events), no request bodies/tokens in logs; authenticated active staff/admin only, per-user Sandbox ownership.
- Workflow Tests: tracking simulations plus shared production status/calculation rules. Simulations are explicitly labeled and do not contact eBay.

## Verified
- Real GetUser identified testuser_crestonglobaltest; real Orders response total 0.
- Real GetMyeBaySelling returned Success without ActiveList; total is unavailable.
- 51 automated provider/tracking/rule tests passed.
- Server rejects unauthenticated calls (401). Database worker executable only by service_role; private tables use RLS and no client grants.
- Database duplicate claim and one-use OAuth actor binding tested in rolled-back transactions.
- New schema security advisor findings are informational RLS-without-policy notices for intentionally server-only private tables. Existing unrelated security warnings remain outside this change.

## Still needs real end-to-end verification
- Forced refresh and seller read-back are verified. Automatic expiry/401 recovery still needs a controlled integration test.
- Create a Sandbox listing and buy it using a separate Sandbox buyer. This seller currently has no orders. Never copy production customer data into fixtures.
- 2026-11-27: attempted to save a clearly labeled test notebook draft in the Sandbox listing UI (9.99 USD, quantity 5, Unbranded). eBay redirected to /sh/lst/drafts and displayed its own "It's not you, it's us" server error. Draft persistence is unconfirmed; nothing was published.
- Verify listing changes on that actual listing, tracking submission/read-back on a paid test order, and receipt in test buyer inbox. These writes have NOT been claimed successful.
- Automatic message scheduling/delivery/Due Refund triggers are NOT enabled. Current messaging is manual test-buyer-only.
- Return label / carrier delivery / received returns require provider-supported Sandbox events; shared-rule simulation does not prove real carrier tracking or payouts.
- Full production KPI/chart/editor design parity, store expense/tax/earnings API parity, image enrichment, all ended/scheduled listings, and full admin monitoring are NOT implemented by this Sandbox increment.
- Profit/tax/margin production formulas are unchanged. API buyer total is not substituted for order earnings; unavailable financial fields show a dash.

## Key files
- sandbox-live.js: actual API connection, pages, actions and refresh.
- sandbox-rules.js / sandbox-scenarios.mjs: clearly separate simulations.
- supabase/functions/ebay-sandbox: Sandbox-only API and OAuth.
- supabase/ebay-sandbox.sql: isolated state, encrypted secrets, atomic claims and audit.

## Sources verified during implementation
- https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetUser.html
- https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetMyeBaySelling.html
- https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/ReviseInventoryStatus.html
- https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/AddMemberMessageAAQToPartner.html
- https://developer.ebay.com/develop/guides/sell/authorization
- https://supabase.com/docs/guides/database/vault
