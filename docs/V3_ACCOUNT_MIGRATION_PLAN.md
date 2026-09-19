# V3 account migration and rollback plan

## Database rollout

1. Add Better Auth tables and new personal tables. Add nullable `user_id` to
   existing preferences and alerts, foreign keys, indexes, and uniqueness that
   permits legacy anonymous rows. Do not alter migrations `0000`-`0005`.
2. Deploy code that understands both legacy anonymous rows and account rows.
   Normal personal APIs use only `user_id`; `owner_token_hash` is read solely by
   migration/delete-anonymous endpoints.
3. Enable account UI and authenticated APIs in staging. Validate row counts,
   orphan checks, two-user isolation, session revocation, and alert scheduling.
4. Offer each signed-in user migrate, skip, or delete. Keep a durable migration
   decision keyed by user and legacy token hash.
5. After a separate production readiness decision, remove legacy access paths.
   Dropping `owner_token_hash` is a later migration, never part of the initial
   rollout.

## Idempotent merge rules

- Claim a legacy token hash once using a unique constraint inside a transaction.
- Repeating a completed operation returns its stored result and performs no
  writes. A failed/partial record may resume safely.
- Preferences use an atomic last-updated merge: the newer row wins, so a newer
  account row is never overwritten by an older anonymous row. The losing
  anonymous duplicate is removed after the decision commits.
- Alerts deduplicate on normalized intent, target, interval, and notification
  subscription. The latest check/trigger state is retained, so migration cannot
  re-fire an already delivered threshold. Losing duplicates are account-bound
  and soft-deleted so account deletion can cascade through their run history.
- Saved searches, saved itineraries, and history use stable content keys.
- `skip` records the decision without modifying legacy rows. `delete` removes
  only rows matching the submitted hash and cannot delete public observations.

## Rollback

- Before staging migration, capture Neon branch/restore-point metadata and row
  counts without exporting secrets.
- Application rollback switches traffic to the V2 baseline while additive
  columns/tables remain harmless. Legacy hashes remain intact for V2 reads.
- Database rollback uses the dedicated down script only after application
  rollback and verification that no account-owned data must be retained. It
  drops only objects added by the V3 migration and never modifies `0000`-`0005`.
- If migration behavior is suspect, disable migration endpoints first, pause
  affected alerts, preserve migration/audit rows, and reconcile counts before
  retrying. Never guess ownership or reassign hashes manually.

## Staging evidence required

- Forward migration and down/up rehearsal on an isolated Neon staging branch.
- Counts for legacy, migrated, skipped, deleted, duplicate, and partial records.
- Confirmation that newer account preferences survive migration and migrated
  alerts do not duplicate or re-trigger.
- Confirmation that account deletion removes personal rows, stops alerts, and
  revokes sessions while public price observations remain queryable.
