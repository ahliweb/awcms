---
"awcms": minor
---

Add the `/admin/approvals` inbox and put `workflow_approval` in the admin sidebar.

The module shipped a complete engine — graph definitions, quorum, delegation, escalation, administrative recovery — and no screen, so every approval in this base could only be decided with `curl`. Under ADR-0051 the screen belongs here.

The inbox lists tasks with the same filters the JSON route accepts (status, workflow key, resource type, overdue, safe search) over keyset pagination, and offers approve/reject, reassign and force-decision per row, a per-instance history panel carrying the cancel action, and the delegation ledger with create and revoke. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; instance history is fetched only when `?instance=` names one, because doing it per row would be up to 100 queries for a list nobody expanded.

Writes go to the guarded endpoints, all six with a fresh `Idempotency-Key` per click — unlike `/admin/reporting` there is no exception here, because every one of them requires the header.

Cancel sits on the instance panel rather than the task row: cancelling ends the whole instance and every pending task under it, so offering it beside a single task would misrepresent its blast radius.

`tests/admin-approvals-page-contract.test.ts` pins the page's eight permission keys against what the routes enforce and the descriptor declares. Two traps are specific to this module and both would deny every caller while reading perfectly: the permission namespace is `workflow`, not `workflow_approval` (the directory, README and descriptor name all say the latter), and approve/reject share one permission — `approval.approve` is the ability to decide, not its direction, and `approval.reject` is seeded nowhere.

The six `definition.*` permissions are deliberately left to their own screen: authoring a node graph needs a real editor, and a raw-JSON textarea that accepts a malformed graph until publish rejects it is a worse affordance than none. The contract test asserts they stay off this page, so the split remains a decision rather than a gap.

`MAX_REASON_LENGTH` — written out as a bare `500` in five separate files — moves to `workflow-approval/domain/reason-bounds.ts`, imported by all of them and by the form that renders it as `maxlength`.

Also corrects `workflow-approval/README.md`, which described an `/admin/workflows` page that never existed in this repo.
