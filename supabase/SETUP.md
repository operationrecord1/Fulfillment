# Supabase setup for Fulfillment

Use the existing Supabase plan for the PostgreSQL backend.

1. Create a Supabase project at https://supabase.com/dashboard.
2. In the project, open **SQL Editor**, paste and run [schema.sql](./schema.sql).
3. In **Authentication → Settings**, keep email/password sign-in enabled and disable public sign-ups. Accounts are created by the owner; the Request Access page only submits an approval request.
4. Create the owner account from **Authentication → Users**. Then use the owner bootstrap SQL at the bottom of `schema.sql`, replacing the placeholder UUID, email, and display name.
5. After reviewing an access request, create that person from **Authentication → Users**. The database creates an inactive profile automatically; assign `staff` or `investor` and set `is_active=true` in the Table Editor.
6. Copy the project URL and the publishable/anon key. These are the only Supabase values that belong in the browser. Never put a service_role key in `index.html`.

The website has the sign-in and request forms ready. They stay safely disconnected until the project URL and publishable/anon key are added to `SUPABASE_CONFIG` in `index.html`.
