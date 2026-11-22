# Supabase setup for Fulfillment

Use the existing Supabase project for the production PostgreSQL and Auth backend.

1. Confirm the production schema matches [schema.sql](./schema.sql), the migrations in [migrations](./migrations), and the deployed `fulfillment-access` Edge Function.
2. Keep email/password sign-in enabled and public Auth sign-ups disabled. Admin accounts are owner-created; Request Access only offers Employee (`staff`) and Investor.
3. Confirm the owner has an active `admin` profile. Admin reviews access and deletion requests in the existing Supabase Table Editor; the website Admin UI is unchanged.
4. Set `BREVO_API_KEY` as a Supabase Edge Function secret. The Brevo key should have restricted Transactional email permission. Set `FULFILLMENT_FROM_EMAIL` to a verified sender and `FULFILLMENT_ADMIN_EMAIL` to the owner’s review inbox. Never store these secrets in GitHub or `index.html`.
5. The browser submits requests only through `fulfillment-access`. Do not grant `anon` or `authenticated` direct INSERT on `access_requests`; the Edge Function validates fields and roles, checks the store for Investors, applies the rate limit, and sends applicant and owner emails.
6. Employee and Investor applicants submit Request Access without a password. The Edge Function sends a branded acknowledgement and notifies the owner; no Auth account is created yet. On approval, the Edge Function creates the Auth account (or prepares a secure recovery link for an existing inactive account), assigns the requested role/store, activates access, and sends an approval email with a one-time `Set password` link. The user can also use Forgot Password from Sign In. Rejection sends a decision email; any inactive pre-existing account is removed.
7. An Investor must request an existing store. Approval assigns that store and view-only role. New data fields/features visible to Investors must be explicitly defined before business data is exposed.
8. An approved Employee’s first sign-in routes to the workspace and asks for a Store Name. It connects to the normalized existing store or creates one if absent. Employee work permissions are still to be defined.
9. Employee and Investor accounts can submit deletion requests only. Owner approval deletes the Auth account; the deletion-request row remains for history. Users cannot directly delete their own accounts.
10. `SUPABASE_CONFIG` in `index.html` contains only the browser-safe project URL and publishable key. Never place a Supabase secret/service key in the site source.

## Current integration boundary

The site implements email/password sign-in, password recovery, role-gated workspace routing, Employee store onboarding, Investor store checks, access requests, and owner-reviewed deletion requests. Supabase Email and Google providers may be enabled, but the site has no Google sign-in button and does not request Gmail API scopes or read mailbox data. Enabling Google sign-in alone does not connect a Gmail mailbox.

The approved Investor role is view-only, but the business data fields/features to expose have not yet been selected. The Employee and Investor work modes will be designed separately; this plan establishes their account entry, approval, store assignment, and deletion paths.

## Password recovery

Apply [reset-policy.sql](./reset-policy.sql) to the Supabase project. The `auth.users` trigger stores each successful recovery send by Auth user ID, so browsers share the same cooldown. Sends 1–5 wait 60 seconds, 6–10 wait 120 seconds, 11–19 wait 300 seconds, and the twentieth send starts a 24-hour lock. The public status RPC returns the next available time without exposing the count. The website renders that time as a countdown.

Keep the verified Brevo sender in Supabase Auth, the 30-minute Email OTP expiry, and the branded recovery template. Supabase’s project-wide email quota and Auth limits still apply independently. Unknown email addresses get a neutral response and do not receive mail.

## eBay connection and read mirror (22 November 2026)

The existing Creston Global Production OAuth application is connected to Fulfilment. Do not recreate its keyset or repeat seller consent during routine development. The callback is `ebay-connect/callback` on this Supabase project, and the browser entry/status page is `https://fulfilment.site/#connect-ebay`. Client credentials and seller tokens are in encrypted Vault, not the repository. The refresh grant renews access tokens and preserves the existing long-lived refresh token. Revoked or expired seller authorization still requires consent again.

Deployment order for a new environment: `ebay-connect.sql`, `ebay-connect` function, `ebay-sync.sql`, `ebay-read.sql`, `ebay-workspace.sql`, `ebay-sync` function, then `ebay-sync-schedule.sql`. Production has the corresponding remote migrations applied. The function verifies the existing private webhook secret itself, so gateway JWT verification is disabled. Neither browser role can invoke its worker RPC or read private records directly. The two browser read RPCs validate the active profile and assigned store; investors cannot access this integration.

`fulfillment-ebay-sync` runs every minute independently of browser activity. Each invocation processes up to 32 pages within a 45-second work budget. Store leases serialize refresh/import operations. Records are upserted by store, resource and eBay ID; a page and its cursor commit together. Failures retain the previous records and cursor and retry with bounded backoff. Orders poll after 120 seconds, listings/returns/transactions after 600 seconds, and analytics after six hours. These are scheduling targets, not guaranteed eBay delivery latency.

Current coverage:

- Orders: first import covers 89 days, then last-modified increments with a five-minute overlap. Full eBay order payloads include monetary, line-item, payment, shipment and cancellation information.
- Listings: active, ended and scheduled listing searches, including products created outside the Inventory API. After the initial catalog, modified-date increments cover all three states. Titles, image URLs, SKU, available/sold quantities, price and status are retained.
- Returns: recent 89-day return requests using the Post-Order OAuth `IAF` authorization scheme.
- Financial transactions: recent 89-day monetary transactions, including the refund/fee types supplied by eBay. No refund is issued by this integration.
- Traffic: up to one year of daily US marketplace reports in bounded windows, then recent 30-day refreshes. Listing-level traffic covers the recent 30-day period and is batched after the listing catalog is available. API response coverage can differ from the requested date range; retain reported dates and applicability flags.

Imported records are separate from the manual spreadsheet/dashboard. The connection page offers an authorized, paginated data preview; it is not the planned final Orders/Listings interface. Notifications/webhooks, multi-marketplace analytics, older order/financial backfills and yearly per-listing analytics are not implemented by this release. Do not label these features enabled merely because OAuth granted the corresponding scopes. Future workers must reuse the saved connection and respect eBay per-API quotas; evaluate quota capacity before onboarding many stores.

Verification: `node --test ebay-oauth.test.mjs ebay-sync.test.mjs auth-callback.test.cjs auth-workspace.test.cjs`. Live checks additionally verified six successful resource jobs, token renewal, private-table/worker access denial, browser record pagination, and successful scheduled dispatches. To pause imports without deleting data or disconnecting eBay, deactivate the named cron job in the database.
