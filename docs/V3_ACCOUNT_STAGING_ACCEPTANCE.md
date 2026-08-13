# V3 account staging acceptance

Date: 2026-08-13
Branch: `codex/v3-development`
Staging API revision: `fa381cbdb1f8e550b512132b0349bbb2adb3b193`

## Implemented scope

- Better Auth email/password registration, verification, login, logout, current
  session, password reset, session listing/revocation, and all-device logout.
- Fastify validates the server-side session before every personal-data route.
  Client-supplied user IDs, email addresses, and legacy owner tokens do not
  authorize normal personal-data access.
- Preferences, alerts, personal search history, saved itineraries, and
  notification settings are scoped by `user_id`. Public route observations and
  external market history remain de-identified and separate.
- Anonymous preference and alert data supports one-time migrate, skip, or
  delete decisions. Claims and retries are transactional and idempotent; newer
  account data and alert delivery state win over older anonymous duplicates.
- Account settings, cross-device restoration, notification opt-in/out, data
  export, account deletion, and session management are present in the existing
  product visual system.

## Verification evidence

- `pnpm check` passed: type checking, lint, 154 workspace tests, and production
  builds. The API suite contains 56 tests, including two-user object isolation,
  session expiry/revocation, login rate limiting, hostile Origin rejection,
  hardened cookies, password reset, anonymous migration, account deletion,
  notification unsubscribe behavior, and personal-search ownership.
- `pnpm test:e2e` passed 16/16 on desktop and mobile Chromium.
- Migration `0006_solid_daimon_hellstrom.sql` was applied to Neon staging. Its
  dedicated down script and forward reapply were rehearsed on an isolated
  staging branch. A pre-migration staging backup branch was retained for the
  documented rollback window.
- Render health reports account authentication and personal storage configured
  at the revision above. Allowed-origin CORS preflight returns 204; a hostile
  auth Origin returns 403.
- The Netlify same-origin proxy path was exercised against the deployed site:
  anonymous session lookup returns 200 with no session, a personal preferences
  read returns 401, and public de-identified price history remains available
  with 200.
- With the Resend owner mailbox `free.skater.hy@gmail.com` as the recipient,
  staging registration produced a Resend `delivered` verification email. The
  link was accepted by Better Auth, the account displayed `邮箱已验证`, login
  succeeded, and a password-reset email was also marked `delivered`. The reset
  flow changed the password and revoked the previous session before a fresh
  login succeeded. This validates the application and Resend test-sender path,
  but does not replace delivery to an external 163.com mailbox.
- Auth verification and reset tokens are now captured in memory and removed
  from the visible browser URL immediately after landing; dedicated Web tests
  cover token and callback URL scrubbing.

## Residual gate

Resend is configured, but `onboarding@resend.dev` is a testing sender that may
only deliver to the Resend account owner's address. It rejected the staged
verification email to an external 163.com test account with HTTP 403. Therefore
real external-mail registration, verification, password reset, and a complete
two-browser cross-device login rehearsal are not accepted yet.

To close this gate without paid upgrades, verify a user-owned sending domain in
Resend, change `AUTH_EMAIL_FROM` to an address on that domain, redeploy Render
staging, and repeat registration, verification, login, reset, revoke, migration,
export, and deletion through the Netlify staging origin. Do not promote this
stage to Production, merge `main`, or create a release tag before that evidence
is recorded.
