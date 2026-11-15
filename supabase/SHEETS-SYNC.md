# Employee Google Sheets mirror

The website database remains authoritative. This is one-way export to the Google
account `operation.record1@gmail.com`; Google edits do not update the website.

An approved active staff profile receives an immutable serial and a spreadsheet
named `Store Name - Serial`. Investors are excluded. An account deletion archives
the mapping; it never deletes the Drive file. A staff profile without an assigned
store initially uses its display name and has empty year worksheets. Assignment
and store-name changes update the existing spreadsheet rather than replacing it.

Each year has `Monthly Statement YYYY` and `Yearly Statement YYYY` worksheets.
Monthly blocks begin A, AA, BA, ... KA; each has 17 columns (Order ID through Order
Date). Row 1 combines the month and column label. Website row N maps to sheet row
N+1. Blank positions are preserved. Yearly rows contain the same raw orders sorted
by month and source position, as in the website's yearly order grid. Computed gross,
margin and readable unique IDs match the grid; no charts or KPI cards are exported.
Initial capacity is 2,000 monthly data rows and 20,000 yearly data rows, plus headers.
Capacity grows when needed, subject to Google's spreadsheet limits.

## Reliability and access

- Period commits enqueue an export in the same database transaction.
- A single leased worker serializes owner-account writes. New source revisions
  remain pending when an older snapshot finishes.
- Checkpoints resume large exports; saved high-water marks clear partially written
  tails even if a later source revision is shorter.
- Clear preserves blank rows. Row deletion follows the website's new positions;
  no entire Google row is deleted across adjacent monthly blocks.
- Literal RAW writes preserve leading-zero IDs and do not execute text as formulas.
- Errors retry with backoff. Cron checks pending work every minute; event dispatch
  is throttled to 20 seconds. Nightly reconciliation repairs mirror drift.
- Ambiguous file creation is reconciled using Drive appProperties. If no unique
  match is found, creation stops for owner review rather than duplicating files.
- RLS tables have no client policies by design. The worker RPC is service-role-only.
  Worker HTTP requests require the existing Vault-backed webhook secret.
- OAuth uses state, PKCE, owner-email verification, and the limited `drive.file`
  scope plus `openid email`. Tokens and client secrets live in Supabase Vault.

## Deployment and connection

Applied migrations are recorded in `migrations/20261115220125_*` and
`migrations/20261115220225_*`. Do not reapply the standalone reference SQL files.
Deploy `sheets-sync` and `sheets-oauth` with JWT gateway verification off: both
endpoints implement their own authentication. Do not remove that authentication.

Vault names: `sheets_google_client_id`, `sheets_google_client_secret`,
`sheets_google_refresh_token`. Never commit their values. Google redirect URI:
`https://glsuoigdjvoojlfyfznq.supabase.co/functions/v1/sheets-oauth/callback`.
The OAuth start endpoint requires an authenticated active administrator. The
callback accepts only the designated Google owner. It does not enable exports.

Before enabling `fulfillment_private.sheets_control.enabled`, complete Google
authorization, confirm production OAuth status, verify a controlled initial export,
then verify the website edit/clear/delete flow against Google. No paid billing
upgrade is required by this implementation; free-tier quotas still apply.

Inspect `sheets_jobs.last_error`, `attempts`, `version`, `completed_version`,
`synced_at` and `progress` to diagnose delays. Disable the control flag to pause new
worker claims; an already-running worker can finish its current batch. Do not clear
jobs or replace the database with spreadsheet data to resolve an export failure.

Tests: `node --test sheets-sync.test.mjs sheets-sync-engine.test.mjs`.
