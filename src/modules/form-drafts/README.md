🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# form_drafts

Generic, domain-agnostic **server-side draft store** for multi-step forms.
Ported from awcms-micro (Issue #484) as row 1 of Wave 1 in
[`docs/awcms/absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).

## What it is, and what it deliberately is not

One table (`awcms_form_drafts`, `sql/062`) holding an **opaque JSONB payload**
plus the coordinates needed to resume it: `module_key`, `wizard_key`,
`resource_type`, `resource_id`, `current_step`.

What a payload **means** is owned by whichever module created it. This module
never inspects it beyond the safety rules below. That is the whole point — it is
what lets one table serve every multi-step form without this module accumulating
domain knowledge it would then have to keep in sync with other modules.

It is `type: "system"` for the same reason `logging` and `data_lifecycle` are:
shared platform mechanism, not a tenant-facing feature.

## Safety rules on the payload

Two rules, both enforced in `domain/form-draft-validation.ts` (pure, no I/O):

1. **Size ceiling** — 32 KB serialized. Generous for a form's worth of scratch
   values while bounding worst-case row bloat. This is draft state, not a
   document store.
2. **Secret-shaped keys are rejected, not redacted.** Any key at any nesting
   depth (including inside arrays) matching `password`, `token`, `secret`,
   `credential`, `api[_-]?key`, or `private[_-]?key` fails the whole write with
   a 400 naming the offending path.

Rejecting rather than silently stripping is the deliberate choice: a caller that
gets a 200 back has no way to tell a stripped field from a saved one, and would
happily go on believing the secret round-tripped.

## Endpoints

All tenant-scoped, RLS-protected, ABAC-guarded (`form_drafts.draft.*`,
seeded by `sql/063`):

| Method   | Path                              | Guard          | Notes                                   |
| -------- | --------------------------------- | -------------- | --------------------------------------- |
| `GET`    | `/api/v1/form-drafts`             | `draft.read`   | Bounded to 100, newest first, no cursor |
| `POST`   | `/api/v1/form-drafts`             | `draft.create` | No `Idempotency-Key` — see below        |
| `GET`    | `/api/v1/form-drafts/{id}`        | `draft.read`   |                                         |
| `PATCH`  | `/api/v1/form-drafts/{id}`        | `draft.update` | Only while status is `draft`            |
| `DELETE` | `/api/v1/form-drafts/{id}`        | `draft.delete` | Soft delete; idempotent by construction |
| `POST`   | `/api/v1/form-drafts/{id}/submit` | `draft.update` | **Requires `Idempotency-Key`**, audited |

**Why `create` needs no idempotency key but `submit` does.** A retried create
costs one extra low-value scratch row the caller can delete. A retried submit
hands the payload to a domain action a second time. The asymmetry is the point —
requiring a key everywhere trains callers to generate throwaway ones, which
weakens the guarantee exactly where it matters.

There is no separate `submit` permission. Submitting is a transition on a draft
you may already edit, so it guards on `draft.update`. Adding a `submit` action
would also mean widening the `AccessAction` union — and an action nobody seeds
into a role denies even the tenant owner, while looking entirely correct in
review.

## Retention: expire, then purge

`bun run form-drafts:purge` (daily) runs two distinct phases, deliberately
separable:

1. `expireOverdueFormDrafts` — a `draft` past its caller-supplied `expires_at`
   becomes `status = 'expired'`. A **transition, not a delete**: the row is still
   there for audit and debugging, just no longer resumable.
2. `purgeExpiredFormDrafts` — physically deletes `expired`/`abandoned` rows older
   than `FORM_DRAFT_DEFAULT_RETENTION_DAYS` (30), by `updated_at`.

Both are bounded (5000/batch) and self-auditing.

### Legal hold enforcement lives here, not in `data_lifecycle`

This module registers a `delegated` `dataLifecycle` descriptor
(`form_drafts.form_drafts`). The `data_lifecycle` engine's dry-run planner may
**read** this table for backlog visibility, but it never mutates it — so a legal
hold enforced only inside that engine would stop nothing.

The real enforcement point is `purgeExpiredFormDrafts`, which asks the injected
`LegalHoldGuardPort` (`_shared/ports/legal-hold-guard-port.ts`) before its
`DELETE` and skips the entire batch when the descriptor is held. Phase 1 is
**not** gated: it never deletes anything, so it carries none of the irreversible
loss a legal hold exists to prevent.

`module.ts` exports `FORM_DRAFTS_LIFECYCLE_KEY` and the purge imports it, so the
key a hold is placed against and the key the purge checks cannot drift. If they
did, the hold would fail open silently and the data would go anyway.

The port is a **source-level seam**, not a capability-registry entry, and is
injected at the composition root (`scripts/form-draft-purge.ts`) — importing
`data_lifecycle` internals directly from here would be a circular cross-module
import.

## Not included in this port

awcms-micro's wizard **component** library (`WizardStepper`, `WizardPanel`,
`WizardActions`, `wizard-client.ts`) is a separate, still-open Wave-0 row
(`src/components/ui/`). This store is usable without it — a wizard talks to this
API, not the other way round.
