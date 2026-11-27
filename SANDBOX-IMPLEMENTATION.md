# Sandbox implementation contract

## Current verified state
Sandbox navigation includes Orders, Listings, Workflow Tests and Connection. Orders and Listings show a disconnected state; no records or totals are invented. Workflow tests use the production tracking provider with an injected simulated transport and never call eBay. Message preview uses sample data only.

## Required connection work (not implemented or verified yet)
- Separate Sandbox application credentials, redirect configuration, seller OAuth consent and test buyer account.
- Server-only encrypted token storage scoped to Sandbox and workspace; no fallback to Production credentials.
- Explicit allowlist of verified Sandbox API hosts; reject arbitrary URLs and Production hosts.
- Independent records, sync cursors, action locks, drafts, audit events and reminders. Never reuse Production store records.
- Inspect permissions and API availability before enabling an action; report missing scopes and provider errors visibly.

## Orders parity requirements retained from the agreed design
- Reuse Dashboard KPI/chart layout, period selection and existing financial formulas. Persist selected month/year and page size independently in Sandbox.
- Buying cost = entered buy price + shipping + additional cost. Order profit = verified order earnings minus buying cost. Removed costs must stop contributing. Missing authoritative earnings remain unavailable.
- Keep cancelled orders in counts. Confirmed cancellation takes precedence over cancellation-related refund; partial refund does not mean Refunded.
- Any nonblank Buy Order ID or explicit valid cost input (including zero) qualifies for Ordered. Account selection, notes and internal tracking do not qualify.
- Shipped/Delivered require confirmed eBay evidence. Return Label Created requires provided-label evidence. Return receipt triggers automatic Due Refund. Preserve manual Due Refund and Out of Stock/Alert locks according to existing rules.
- Same Order/Product/Buyer/Actions popup, stable size and responsive layout. Edit Product remains deferred.
- Separate internal tracking from eBay tracking. One eBay tracking per order; fresh check before submission; block existing shipment, concurrent requests and uncertain automatic retries. Read back before claiming success.
- Message templates: purchase, delivered, manual Due Refund delivery. One expanded panel. Do not send without a configured template and verified recipient/event. Persist deduplication and delivery result separately from internal reminder email.

## Listings parity requirements
- Active, ended and scheduled results must be distinguishable; paginate all supported results and verify totals instead of counting cached history.
- Verify exact Sandbox listing ownership before edits. Read back title, price, quantity and status after API writes.
- Keep missing images, failed syncs and unavailable analytics visible; no fabricated metrics.

## Verification gates
1. Sandbox seller authorization succeeds and identity is verified.
2. Actual test orders and listings load with source, timestamp, pagination and errors.
3. Tracking write/read-back, existing-shipment block and unknown-result reconciliation pass on Sandbox orders.
4. Listing edit/read-back passes; refresh and navigation preserve the chosen view.
5. Customer messaging passes against a test buyer. API support for return labels/delivery events is verified separately; simulations are explicitly labelled.
6. Responsive checks at 300, 390, 700, 1100 and large desktop widths; no Production data writes during any test.

Sandbox success is not proof of real carrier delivery, payout release, Production permissions or zero downtime.
