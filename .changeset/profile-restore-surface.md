---
"awcms": minor
---

`POST /api/v1/profiles/{id}/restore` — the counterpart `DELETE
/api/v1/profiles/{id}` shipped without (ADR-0058 §A).

`sql/003` gave `awcms_profiles` `restored_at`/`restored_by` and an index on
`(tenant_id, deleted_at)`, and `party-directory.ts` exported `softDeleteParty`
with nothing to undo it. Nothing in the repo could write either column, so a
soft-deleted profile was permanent while `profile_management.restore` sat
seeded in the catalogue and enforced by nothing.

The precondition is the `WHERE … deleted_at IS NOT NULL`, not a read before the
write: two concurrent restores that both read first would both proceed and
audit two restorations of one profile. `delete_reason` is kept — why the
profile was deleted stays true after it is restored. A profile that does not
exist and a profile that is not soft-deleted answer the same 404, so the route
cannot be used to probe which profile ids exist.

Permission-enforcement coverage moves from 201/205 with 4 exceptions to 202/205
with 3.
