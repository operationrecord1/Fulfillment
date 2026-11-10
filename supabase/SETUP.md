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
