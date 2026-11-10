-- Request submissions must pass through the server-side Edge Function so role/store validation, throttling, and transactional emails cannot be bypassed.
drop policy if exists "public can submit pending access request" on public.access_requests;
revoke insert on table public.access_requests from anon, authenticated;
