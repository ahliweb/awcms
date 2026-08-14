---
name: awcms-workflow-approval
description: Work on any part of the AWCMS workflow_approval module (Issue 11.1 linear engine, evolved by Issue #747 epic platform-evolution #738 Wave 2 into a graph-based managed engine). Use when adding a new graph node, delegation/escalation/administrative-recovery, or a condition/action resolver. PR #778 fixed 4 security findings before merge — this summarises the invariants that must be preserved so they are not regressed.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Workflow Approval Module

`workflow_approval` (`src/modules/workflow-approval`, Issue 11.1 then
evolved by Issue #747 epic `platform-evolution` #738 Wave 2) is the minimum
**managed, versioned, graph-based** enterprise workflow — while still keeping
the original base guardrails: no domain-specific business terms/actions (the base does not
send a POS cancel/Coretax export/warehouse transfer), no external BPMN
engine, and no runtime code execution in conditions/actions
(doc 21 §3 decision tree, node Q5). Read
`src/modules/workflow-approval/README.md` for the full detail; this skill
summarises the security invariants that MUST be preserved (the 4 findings of PR #778
have already been regressed once, do not repeat them).

## When to use this skill vs the generic skills

It complements `awcms-abac-guard` (the self-approval-deny check that is reused
here), `awcms-idempotency`, `awcms-audit-log`. This skill
supplies the graph-engine context and the security invariants specific to this module.

## Evolution from Issue 11.1 (linear) to Issue #747 (graph-based managed)

| Issue 11.1 (linear)                          | Issue #747 (managed, graph-based)                                          |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| One `status: active/inactive` per definition | `version` + `lifecycle_status: draft/active/retired`, immutable versions   |
| `steps` (ordered jsonb list)                 | `graph` (nodes/transitions — approval/condition/parallel/join/notify/end)  |
| No public create-definition endpoint         | `POST/PUT/DELETE /workflows/definitions`, `.../publish`, `.../retire`, etc |
| `current_step_order` (a single int)          | `awcms_workflow_tasks` (one row per active node — multiple active nodes)   |
| One implicit assignee                        | `_task_assignments` — quorum/any/all, delegation-resolved deciders         |
| No delegation                                | `_delegations` — effective-dated, scoped, reason, audited, revocable       |
| No escalation/timeout                        | Per-node `escalation` config + `workflow:escalations:dispatch`             |
| No administrative recovery                   | Reassign/cancel/force-approve/force-reject, permission-gated+audited       |

## Graph model (`domain/workflow-graph.ts`) — a CLOSED node type set, not a scripting engine

- **`approval`** — 1+ `assigneeTenantUserIds`; `quorumRule` (`all`/`any`/
  `quorum` + `quorumThreshold`) determines when the node completes. A single
  `reject` ALWAYS completes the node as rejected, whatever the rule is
  (a deliberately conservative default, `domain/workflow-quorum.ts`).
  Optional `escalation` config (`timeoutMinutes`,
  `escalateToTenantUserId`, `maxEscalations`).
- **`condition`** — EITHER: a bounded comparison (`factKey`/
  `operator`/`value`, operators `eq|neq|gt|gte|lt|lte|in`) over a fact
  declared in the definition's `factsSchema`, OR a reference to a
  statically registered `WorkflowConditionResolver` (`resolverName`).
  Never both, never neither.
- **`parallel`**/**`join`** — fan-out into 2+ concurrent branches, fan-in after
  ALL branches arrive at the join (`awcms_workflow_join_arrivals`). Nested
  parallel/join is **NOT supported** (see §Deferred).
- **`notify`** — triggers a notification through the capability port
  `WorkflowNotificationPort` (ADR-0011; adapter in `email`, wraps
  `enqueueAnnouncement`) and immediately continues; never blocking.
- **`end`** — terminal; sets the instance outcome.

`validateWorkflowGraph` structurally validates every node reference,
the quorum threshold bounds, the parallel/join branch-set match, and rejects
cycles (DFS) — it runs on EVERY definition write AND again at publish
(defense in depth).

## Version pinning

`awcms_workflow_instances.workflow_definition_id` (FK, immutable
once published) + the denormalised `workflow_definition_version`
pin each instance to EXACTLY the definition row that was active when
`startWorkflowInstance` ran. Because published/active/retired rows
are never edited in place (`application/workflow-definition-directory.ts`
enforces editing only for `draft`), every later read/advance of the instance
always re-fetches an identical graph regardless of newer versions
published afterwards.

## Delegation (`domain/workflow-delegation.ts`)

Delegation ONLY lets the delegate act using the delegator's OWN
standing — NEVER a permission grant, never broader than the
`workflowKey`/`resourceType`/effective window declared by the delegation
row itself. The self-approval denial (`identity-access/domain/
access-control.ts`, unchanged) still compares the tenant user who is
ACTING against the instance's `requested_by_tenant_user_id` — a delegate CANNOT
be used to approve a request the delegator themselves submitted.
Create (`POST /workflows/delegations`) and revoke
(`POST /workflows/delegations/{id}/revoke`) MUST carry `Idempotency-Key` and
are recorded via `recordAuditEvent` (IN ADDITION to the domain events
`workflow.delegation.created`/`.revoked` already published through the
`domain_event_runtime` outbox — the audit log and the domain event are TWO
different records, consumed independently, not the same thing). Revoke
is gated on the permission `workflow.delegation.revoke` (Owner/Manager per
doc 17) — the ownership check in `revokeWorkflowDelegation` (only the original
delegator may revoke) remains as defense-in-depth ON TOP of that permission
gate, not as a replacement (see §Security findings below — this was once a bug).

## Escalation/timeout (`application/workflow-escalation.ts`)

Built on top of the shared worker runner (`src/lib/jobs/job-runner.ts`) —
bounded batch, advisory lock, `--dry-run`. **Idempotency guard**: the escalation
`UPDATE` is conditioned on `WHERE status = 'pending' AND escalation_step =
<value read in this pass>` — the losing race (a concurrent run, or a retried
pass) affects zero rows and is silently skipped, never escalating
twice. **Its DB role**: this job runs as the least-privilege role
`awcms_worker`.

> **CORRECTION 15 August 2026 — the previous version was WRONG, and wrong in a
> dangerous direction.** It stated that this repo "has no `awcms_worker` role",
> that `WORKER_DATABASE_URL` falls back to `DATABASE_URL` so
> "privilege separation DOES NOT exist here yet", and forbade writing
> `GRANT ... TO awcms_worker` because it "would fail to run". All four are wrong:
>
> - `awcms_worker` IS CREATED in `sql/022_awcms_db_worker_setup_roles.sql`
>   (Issue #163), it is not absent.
> - This repo's migrations contain **78** `GRANT ... TO awcms_worker` statements
>   that have long been running — that prohibition would reject correct work.
> - Production is verified to use that separation: `WORKER_DATABASE_URL`
>   points at `awcms_worker`, `DATABASE_URL` points at `awcms_app`.
> - `sql/022` already grants `awcms_workflow_instances` **`SELECT` only** —
>   which is exactly the fix for PR #778's finding #4, already in place here.
>
> The direction of the error is what made it expensive: an agent who believed it would
> REFUSE to write worker GRANTs and run the job as the owner role,
> thereby removing the privilege separation that already exists — a security
> regression born of documentation, not of code. The `awcms-deploy` skill has already
> been corrected for the same claim; this file was missed.

The worker grants for this module live in `sql/022` and `sql/127`, and are
**gated**: `WORKER_ROLE_GRANTS` in `scripts/security-readiness.ts`
declares the expected set (`awcms_workflow_tasks` `SELECT,UPDATE`;
`awcms_workflow_instances` `SELECT`; `awcms_workflow_definitions` `SELECT`;
`awcms_workflow_task_assignments` `INSERT,SELECT`). Adding a grant without
adding it to that list will turn `security:readiness` red.

## Administrative recovery (`application/workflow-recovery.ts`)

Reassign (`POST /workflows/tasks/{id}/reassign`), cancel
(`POST /workflows/instances/{id}/cancel`), force-approve/force-reject
(`POST /workflows/tasks/{id}/force-decision`) — each is
permission-gated (`workflow.recovery.reassign`/`.cancel`/`.force_decide`),
reason-required, `Idempotency-Key`, fully audited. It never overwrites/
deletes an earlier decision/task/assignment row — it always appends a new row
or performs a guarded status transition.

## CRITICAL — the 4 security findings of PR #778 (fixed before merge, do not regress)

1. **`force-decision` self-approval bypass (High)** — the route authorised
   via `workflow.recovery.force_decide` WITHOUT populating
   `resourceAttributes.requestedByTenantUserId`, and the self-approval-deny
   check in `access-control.ts` was hardwired to the action `"approve"` only —
   so a caller who submitted their OWN instance and holds
   `force_decide` could force-approve their own request, bypassing quorum
   entirely. Fix: look the task/instance up BEFORE the guard (the same pattern as
   `decisions.ts`), and the self-approval-deny check was widened to cover
   `"force_decide"` as well (blocking force-approve AND force-reject of one's own
   instance). **A new recovery endpoint must look the requester up
   BEFORE the guard, following this pattern.**
2. **Missing audit log entries (High)** — `publish`, `retire`, the
   `DELETE` definitions handler, and delegation create/revoke did not call
   `recordAuditEvent` even though they are high-risk mutations; all five now
   call it. `DELETE .../definitions/{id}` and both delegation endpoints
   also lacked `Idempotency-Key` enforcement for a while —
   it has now been added.
3. **The permission `workflow.delegation.revoke` was not enforced (Low)** —
   the revoke route was gated on `workflow.delegation.read` and relied ONLY
   on the ownership check; the already-seeded `revoke` permission
   (doc 17: Owner/Manager `RCV`) became dead code. Fix: gate on
   `workflow.delegation.revoke`.
4. **Worker role escalation-job over-grant (Low)** — in mini, migration 060
   granted `SELECT, UPDATE` on `awcms_workflow_instances` to
   `awcms_worker`, even though the escalation job only ever `SELECT`s from
   that table. Trimmed to `SELECT`-only.

   **CORRECTION 15 August 2026:** the previous version called this finding
   "vacuous in this repo" because it claimed the role and its migration did not exist.
   The opposite is true — and that is good news: `sql/022:145` already grants
   `awcms_workflow_instances` **`SELECT` only**, so the correct shape is
   ALREADY in place, and `WORKER_ROLE_GRANTS` in `security-readiness.ts`
   KEEPS it that way. The lesson therefore applies fully here,
   not pending a port: every new worker grant must be no larger than the query
   actually executed, and the gate will demand that the list be updated
   along with it.

**The generic lesson from all four**: a new action endpoint on a resource
that has an "owner/requester" concept MUST (a) look the requester up BEFORE
the guard so self-approval-deny has something to compare, (b) always call
`recordAuditEvent` for high-risk mutations even for a "mere" administrative
action, (c) gate on its OWN SPECIFIC permission (do not reuse the weaker
`.read` permission), (d) worker role grants are ALWAYS
verified to be no larger than what the real queries actually use.

## Deferred (deliberately out of scope for #747, do not assume it exists)

- **Nested `parallel`/`join`** — a branch that has its own `parallel` node
  is NOT supported; `awcms_workflow_join_arrivals` assumes a single level
  of nesting.
- **`any`-join** — only `all`-join is implemented.
- **The `action` node type** that calls a registered `WorkflowActionHandler`
  — the registry/port exists and is tested, but no node type calls
  it yet.
- **SoD hooks from Issue #746** — the self-approval/delegation authorization
  here is designed so a future SoD hook can plug into
  `findEligibleAssignment`/`evaluateAccess` without a rewrite, but nothing
  SoD-specific has been built here yet.
- **A visual definition/graph editor** — `POST/PUT /workflows/definitions/**`
  is API-only, there is no graph authoring UI.

## Idempotency

Every high-risk mutation (`decisions`, `reassign`, `force-decision`,
`publish`, `retire`, `DELETE .../definitions/{id}`,
`.../instances/{id}/cancel`, `.../delegations` create,
`.../delegations/{id}/revoke`) requires `Idempotency-Key`, using the same
generic `awcms_idempotency_keys` store.

## Common pitfalls

1. A new recovery/decision endpoint must look the requester/owner up BEFORE
   calling `evaluateAccess` — otherwise the self-approval-deny check
   has no value to compare against (see finding #1 above).
2. Do not forget `recordAuditEvent` for a new mutation — a domain event via
   `appendDomainEvent` is NOT a replacement for the audit log, both must be present.
3. Do not reuse the `.read` permission as a mutation gate — always create an
   action-specific permission (`.revoke`, `.reassign`, etc.).
4. Do not add nested `parallel`/`join` without redesigning
   `awcms_workflow_join_arrivals`'s fan-in schema — the single-level
   nesting assumption is baked into it.
5. Do not add code/expression evaluation to the `condition` node — only
   bounded comparisons or statically registered resolvers, never
   `eval`/scripting.

## Verification

Look for `tests/**/workflow*.test.ts` and `tests/integration/workflow*.integration.test.ts`
for the self-approval-deny, quorum, delegation, escalation idempotency,
and recovery action tests. Run `bun test` with `DATABASE_URL` — `bun run
check` without `DATABASE_URL` silently skips the integration tests.
