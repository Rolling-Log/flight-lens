# ADR 0005: Account authentication and API boundary

- Status: Accepted for the account foundation
- Date: 2026-08-13

## Context

Flight Lens runs a Next.js 16 Web app on Netlify, a Fastify 5 API on Render, and
Drizzle over Neon Postgres. V2 browser data is associated with an untrusted
`ownerToken`. V3 needs revocable accounts without weakening public flight search
or the existing price semantics.

## Decision

Use Better Auth 1.6.x with its Drizzle PostgreSQL adapter in the Fastify service.
The selected release is MIT licensed and declares support for Next.js 16,
React 19, and Drizzle 0.45.x. Fastify mounts the Better Auth Web handler and
validates every protected request with `auth.api.getSession`; database methods
receive only that verified session user ID.

Browser requests use a same-origin Netlify `/api/*` proxy to Render. This keeps
the production session cookie host-only, `Secure`, `HttpOnly`, and `SameSite=Lax`
instead of depending on third-party cookies between unrelated `netlify.app` and
`onrender.com` sites. Local development may call Fastify directly from the two
explicit localhost origins with credentials enabled. Better Auth trusted origins
and Fastify CORS both use an exact allowlist. CSRF/origin checks stay enabled.

Database-backed sessions are used without cookie session caching so expiry and
revocation take effect on the next protected request. Email/password sign-up
requires verification. Verification and reset links are sent through a
configured transactional email HTTP API; secrets and tokens are never logged.

Public search and public, de-identified route price observations remain
anonymous. Preferences, alerts, saved searches, saved itineraries, notification
settings, exports, and account deletion require a verified session.

## Consequences

- Render is the authorization authority even when Netlify proxies the request.
- A client-supplied user ID, email, or `ownerToken` never authorizes normal
  personal-data access.
- The Netlify proxy is part of the staging authentication path and must be tested
  before release. Direct cross-site cookies are not a fallback.
- Better Auth schema updates must be generated and reviewed as new migrations;
  deployed migrations `0000` through `0005` remain immutable.

## Official references checked

- [Installation](https://www.better-auth.com/docs/installation),
  [email/password](https://www.better-auth.com/docs/authentication/email-password),
  [session management](https://www.better-auth.com/docs/concepts/session-management),
  [security](https://www.better-auth.com/docs/concepts/security),
  [Fastify integration](https://www.better-auth.com/docs/integrations/fastify),
  and the [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
  were checked on 2026-08-13.
- Better Auth npm stable release 1.6.27 and the
  [repository license and peer metadata](https://github.com/better-auth/better-auth)
  were checked on 2026-08-13.
