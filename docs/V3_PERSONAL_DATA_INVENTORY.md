# V3 personal data inventory

## Existing V2 ownership

| Object | Storage | Current ownership | V3 treatment |
|---|---|---|---|
| Preferences | `user_preferences` | SHA-256 of browser `ownerToken` | Add `user_id`; migrate once; account-only afterward |
| Price alerts | `price_alerts`, `alert_runs` | SHA-256 of browser `ownerToken` | Add `user_id`; preserve run/idempotency state; account-only afterward |
| Search audit | `searches`, `connector_runs`, `offers` | No user ownership | Keep operational/de-identified; create a separate personal search-history link |
| Site price observations | `price_observations` | Public route/date evidence | Keep public and de-identified; never delete through a personal-history endpoint |
| External market history | Connector response only | Public route/date evidence | Keep public and separate from site observations |
| Saved itineraries | Not implemented | None | Add a user-owned table |
| Notification settings | Embedded `ntfyTopic` in preferences/alerts | Anonymous token owner | Add user-owned settings; redact delivery targets from normal responses/exports as appropriate |
| Device sessions | Not implemented | None | Better Auth session table; user may list/revoke own sessions |

## `ownerToken` data flow

The Web creates a random token in `localStorage` under
`flight-lens-owner-token`. It sends the raw token in `x-flight-lens-owner` for
alert reads/updates/deletes/tests and in JSON when creating an alert or saving
preferences. Fastify checks only token length. The database hashes the token
with SHA-256 and scopes preference/alert queries by that hash.

This token is migration proof only in V3. Normal personal routes reject it.
Migration endpoints accept it only with a valid session and only target the
session user. Migration records retain the hash, status, counts, and timestamps,
never the raw token.

## Existing API boundary issue

`DELETE /v2/prices/history` currently accepts the mere presence of an
`ownerToken` and deletes shared route observations. Those observations are not
owned by that token. V3 removes this destructive behavior: public observations
remain public, while deletion of personal search history affects only the
authenticated user's history links.
