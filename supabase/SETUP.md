# Supabase setup for Fulfillment

Use the existing Supabase plan for the PostgreSQL backend.

1. Use the Fulfillment Supabase project at https://supabase.com/dashboard (or create a separate project for a new environment).
2. Confirm the production schema matches [schema.sql](./schema.sql). The schema creates the profile trigger and access-request policies; it does not create an account-approval endpoint.
3. Keep email/password sign-in enabled and public sign-ups disabled. Accounts are created by the owner; Request Access only submits an approval request.
4. Confirm the owner account has an active `admin` profile. New Auth users receive an inactive `staff` profile by default.
5. After reviewing an access request, create the person from **Authentication → Users**, then set the profile role to `staff` or `investor` and `is_active=true` in the Table Editor.
6. `SUPABASE_CONFIG` in `index.html` contains the browser-safe project URL and publishable key for the current deployment. Verify those values when pointing at a different environment. Never put a `service_role` key in `index.html`.

## Current integration boundary

The site implements email/password sign-in, password-reset email requests, and access-request inserts. Supabase Email and Google providers may be enabled in the project, but the site currently has no Google sign-in button and does not request Gmail API scopes or read mailbox data. Enabling the Google provider in Supabase alone does not create a Gmail mailbox connection.

The access-request form does not create Auth users or activate roles. The owner must provision each approved account in Supabase. A user's Auth email/password must also be valid before the role/profile check can run.

## Password recovery

Apply [reset-policy.sql](./reset-policy.sql) to the Supabase project. The `auth.users` trigger stores each successful recovery send by Auth user ID, so browsers share the same cooldown. Sends 1–5 wait 60 seconds, 6–10 wait 120 seconds, 11–19 wait 300 seconds, and the twentieth send starts a 24-hour lock. The public status RPC returns the next available time without exposing the count. The website renders that time as a countdown.

Keep the verified Brevo SMTP sender in Supabase Auth, the 30-minute Email OTP expiry, and the branded recovery template. Supabase's own project-wide email quota and Auth limits still apply independently; increase those settings if actual traffic needs it. Unknown email addresses get a neutral response and do not receive mail.
