# Authentication regression tests

Requires Node.js and Playwright (tested with 1.62.1), plus its Chromium browser.

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/auth-flows.cjs
```

Set `CHROMIUM_PATH` to use an existing Chromium executable.

The tests render the actual index.html in Chromium, intercept external assets,
and replace the Supabase SDK with deterministic success/failure responses.
No email is sent and no production record or account is changed.

20 scenarios passed during this repair. These tests verify frontend behavior,
not the production Supabase configuration, RLS, mail delivery, or account provisioning.

## Release gate still pending

Before merging into the GitHub Pages deployment branch:

- Sign into the existing Supabase project dashboard.
- Verify redirect allowlist and invitation/recovery email configuration.
- Verify request persistence and owner review with an authorized test account.
- Complete a real invitation/reset, then sign in, refresh, and sign out.
- Verify inactive/unapproved accounts cannot access protected data.
- Complete or confirm the owner's account provisioning/activation workflow.

No automated server-side approval endpoint exists in this repository. The current
setup documents manual owner provisioning in Supabase. A submitted access request
does not itself create an Auth user or activate their profile.
