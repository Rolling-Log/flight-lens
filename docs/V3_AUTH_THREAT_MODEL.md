# V3 account threat model

## Trust boundaries

1. The browser is untrusted. Submitted `userId`, email, session metadata, and
   `ownerToken` are claims, not identity.
2. Netlify terminates the public Web origin and proxies `/api/*`; it does not
   make authorization decisions.
3. Fastify and Better Auth validate the host-only session cookie against Neon.
   The resulting session user ID is the only personal-data principal.
4. Neon enforces foreign keys and uniqueness. Query code must additionally scope
   every personal object read, update, and delete by `user_id`.
5. Email and notification providers receive only the minimum delivery payload.

## Priority threats and controls

| Threat | Control and verification |
|---|---|
| Cross-user object access | Ignore client identity fields; query by object ID plus session `user_id`; two-user tests for every object class |
| Stolen/expired session | `HttpOnly`, `Secure`, `SameSite=Lax` cookie; database lookup on each protected request; expiry and revoke tests |
| CSRF and hostile origins | Same-origin proxy, Better Auth origin checks, exact trusted origins, credentialed CORS allowlist, reject missing/foreign Origin on unsafe authenticated requests |
| Credential stuffing/enumeration | Dedicated sign-in/reset/verification rate limits; generic UI errors; Better Auth enumeration-safe verified sign-up behavior |
| Token leakage | Never log passwords, cookies, reset/verification/session tokens, raw owner tokens, topics, or provider secrets; authenticated exports may contain the user's own notification settings but are never logged or shared |
| Anonymous migration theft/replay | Require a valid session, hash submitted token, unique hash/idempotency constraints, transactionally claim once, expose no data before claim |
| Migration overwrite/data loss | Merge only missing fields or when anonymous `updated_at` is newer; alert semantic dedupe; retain source rows until completion; partial failure is retryable |
| Duplicate/false notifications | Preserve alert and run IDs where possible, unique migration/dedupe keys, keep `lastTriggered*`, pause alerts during unresolved migration |
| Account deletion race | Better Auth verifies the fresh password and deletes the auth user; database cascades remove sessions, alerts, and personal rows while public observations remain de-identified |
| Open redirect/link abuse | Allowlist Web callback origins; provider links never appear in auth callback parameters unchecked |

## Residual limits

- A compromised browser can use its current session until it is revoked.
- Email-account compromise defeats email verification/reset; multi-factor auth is
  outside this account-foundation phase.
- Netlify proxy and Render header behavior require real staging validation.
- Free email/hosting tiers can delay delivery or cold-start requests; failures
  must be visible and retryable, never reported as successful delivery.
