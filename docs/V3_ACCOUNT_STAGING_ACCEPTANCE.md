# V3 account staging acceptance

Date: 2026-08-14
Branch: `codex/v3-development`
Staging API revision: `987e0986a59817b8aefe6d27d6d54d88a008517b`

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

- `pnpm check` passed: type checking, lint, 157 workspace tests, and production
  builds. The API suite contains 59 tests, including two-user object isolation,
  session expiry/revocation, login rate limiting, hostile Origin rejection,
  hardened cookies, password reset, anonymous migration, account deletion,
  notification unsubscribe behavior, personal-search ownership, and saved
  itinerary read/delete ownership at both the Fastify and database layers.
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
- Resend domain `mail.flightlens.cn` is verified in Tokyo and Render staging now
  uses `Flight Lens <noreply@mail.flightlens.cn>`. Registration resend and
  password-reset requests for `a18807718007@163.com` returned success; Resend
  marked both messages `delivered`. The verification link was accepted by
  Better Auth, the account displayed `邮箱已验证`, the user completed the reset
  step, and the staging UI confirmed a fresh login as that 163 account.
- Auth verification and reset tokens are now captured in memory and removed
  from the visible browser URL immediately after landing; dedicated Web tests
  cover token and callback URL scrubbing.
- Two disposable Gmail aliases were registered and verified through the Netlify
  origin, then authenticated as three independent Cookie clients. A preference
  written by device A1 was restored by A2, while user B retained empty/default
  preferences and notification settings. Extra client-supplied `userId`, email,
  and `ownerToken` fields did not change ownership. Account-name changes and an
  email-notification opt-out were also restored by A2.
- A one-time anonymous `skip` decision returned the same migration record when
  retried from A2; user B received `409 ANONYMOUS_TOKEN_ALREADY_CLAIMED` for the
  same owner token. Integration tests separately cover migrate/delete behavior,
  newer-data preservation, duplicate-alert suppression, and delete idempotency.
- Account export returned an attachment containing A's preferences and current
  notification settings without B's data. A single-device revoke invalidated A2
  but retained A1; all-device logout then invalidated both active A sessions.
  Both disposable accounts were deleted afterward, their sessions became null,
  and subsequent password login returned 401.
- Through the deployed Netlify proxy, a hostile auth Origin returned 403, an
  anonymous personal export returned 401, and public de-identified price history
  remained available with 200.

## Residual gate

No account-and-personal-data staging blocker remains. The Edge automation
extension still blocks direct controlled navigation to `/api/backend/*`, so the
cross-device protocol acceptance used independent HTTP Cookie clients instead
of a second graphical browser; desktop and mobile UI behavior remains covered by
Playwright E2E.

This does not clear the broader production release gate. Render health still
reports only two production purchase-handoff connectors and zero production
verification connectors against the required two-plus-two mix. Long-running
source reliability, reminder delivery, suppression, and cost telemetry also
remain outside this account-phase acceptance. Do not promote to Production,
merge `main`, or create a release tag until those later gates are addressed.
