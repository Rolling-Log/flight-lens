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

- `pnpm check` passed: type checking, lint, 155 workspace tests, and production
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
- Resend domain `mail.flightlens.cn` is verified in Tokyo and Render staging now
  uses `Flight Lens <noreply@mail.flightlens.cn>`. Registration resend and
  password-reset requests for `a18807718007@163.com` returned success; Resend
  marked both messages `delivered`. The verification link was accepted by
  Better Auth, the account displayed `邮箱已验证`, the user completed the reset
  step, and the staging UI confirmed a fresh login as that 163 account.
- Auth verification and reset tokens are now captured in memory and removed
  from the visible browser URL immediately after landing; dedicated Web tests
  cover token and callback URL scrubbing.

## Residual gate

The remaining staging browser gate is personal-data interaction through the
Netlify `/api/backend/*` proxy. The Edge automation extension currently returns
`ERR_BLOCKED_BY_CLIENT` for that path, while direct health, CORS preflight, API
unit/integration coverage, and desktop/mobile E2E remain green. Consequently,
manual staging evidence for preference persistence, anonymous migration,
export, and a genuinely independent second-device session is not recorded yet.
Use a normal browser session with the extension restriction removed, then repeat
those actions and record the response evidence here. Do not promote this stage
to Production, merge `main`, or create a release tag before that evidence is
recorded.
