---
name: awcms-form-drafts
description: The form_drafts module HAS ALREADY been ported into this repo (from awcms-micro Issue #484; migrations `sql/062` schema + `sql/063` permissions, Wave-1 row 1 of `docs/awcms/absorb-awcms-micro-roadmap.md`). A generic, domain-agnostic server-side draft store for multi-step forms — `type: system`, deps `[identity_access]`, table `awcms_form_drafts` (ENABLE+FORCE RLS), endpoints `/api/v1/form-drafts/*`, two-phase retention job `bun run form-drafts:purge` with a legal-hold gate. Use when adding/changing form progress storage, payload rules, or draft retention. NOTE: the wizard COMPONENT library (`WizardStepper`/`wizard-client.ts`) DOES NOT EXIST here yet (the Wave-0 row `src/components/ui/` is still open as a need, not as a port queue) — the `awcms-wizard-form` skill stays READ-ONLY.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Server-Side Form Draft Persistence

Follow `src/modules/form-drafts/README.md`. This module **exists and can be called**
in this repo — ported from awcms-micro Issue #484.

> **What was NOT ported along with it** (do not claim it exists, this has been verified absent):
>
> - The wizard component library `src/components/ui/` (`WizardStepper`,
>   `WizardPanel`, `WizardActions`, `wizard-client.ts`) — a Wave-0 row
>   that is still open. The `awcms-wizard-form` skill is still READ-ONLY.
> - `docs/awcms/examples/wizard-form-pattern.md` — does not exist in this repo.
> - `awcms-micro:src/pages/admin/examples/wizard.astro` (the micro pilot) — does not exist in this
>   repo; `src/pages/admin/examples/` itself does not exist.
>
> This store is still useful without all three: what a wizard calls is its
> API, not the other way round.

## When to use a server-side draft

Only when the user needs to resume across sessions/tabs/devices, or there is an
audit requirement over form progress. A short form finished in one sitting is fine with
in-memory client state — do not add a network round-trip without that reason.

## API

`GET/POST /api/v1/form-drafts`, `GET/PATCH/DELETE /api/v1/form-drafts/{id}`,
`POST /api/v1/form-drafts/{id}/submit`. Guarded by
`form_drafts.draft.{read,create,update,delete}` — generic, not per
`moduleKey` of the draft's creator (RLS already isolates the tenant).

**There is no `submit` action.** Submit is guarded by `draft.update`. Adding a
`submit` action would mean widening the `AccessAction` union **and** planting a
latent-authz trap: an action that is never seeded to a role will deny
even the owner, while the code looks correct at review time.

## Mandatory rules

1. **`moduleKey`/`wizardKey`/`resourceType` belong to your own module** —
   lowercase snake_case (`^[a-z][a-z0-9_]{1,63}$`). This pattern is CHECKed in
   `sql/062` **and** in `domain/form-draft-validation.ts`; change both
   together (`tests/form-drafts-module.test.ts` keeps them identical).
2. **The payload must not contain fields that look like secrets**
   (`password`/`token`/`secret`/`credential`/`api[_-]?key`/`private[_-]?key`,
   checked recursively including inside arrays) — **REJECTED with 400, not
   silently redacted**. The reason matters: if it were silently stripped,
   the caller would get a 200 and could not tell a discarded field from a
   stored one. Do not store sensitive data in a draft at all.
3. **Payload maximum 32KB serialized** (`MAX_PAYLOAD_BYTES`) — scratch state,
   not a document/attachment store.
4. **Create/update/delete do NOT need an `Idempotency-Key`; submit MUST have one.**
   Retrying a create = one low-value scratch row that can be deleted;
   delete is structurally idempotent (`deleted_at IS NULL`). Retrying a submit =
   handing the payload to a domain action twice. This asymmetry is deliberate —
   requiring a key everywhere trains callers to invent throwaway keys,
   which actually weakens the guarantee where it matters.
5. **Only `status = 'draft'` is editable** — submitted/abandoned/expired
   answer `404` to a PATCH (not distinguishing "wrong state" from "does not
   exist").
6. **Resume-on-load goes through the application layer directly from SSR**
   (`listFormDrafts(tx, tenantId, { moduleKey, wizardKey, status: "draft" })`),
   not an HTTP round-trip to your own endpoint.

## Two-phase retention + legal hold (do not change this without reading this)

`bun run form-drafts:purge` (daily, cron/systemd/CronJob — not over HTTP):

1. `expireOverdueFormDrafts` — a `draft` past `expires_at` → `status='expired'`.
   **A transition, not a delete**; the row is still there for audit/debug.
2. `purgeExpiredFormDrafts` — physical DELETE of `expired`/`abandoned` rows
   older than the retention cutoff (default 30 days; `--retention-days=<n>`,
   then env `FORM_DRAFT_RETENTION_DAYS`).

**The legal hold enforcement point is in phase 2 in this module, NOT in the
`data_lifecycle` engine.** This module's descriptor is `executionMode: "delegated"` — the
`data_lifecycle` planner only READS this table for backlog visibility and never
mutates it, so a hold enforced only in that engine would not
stop anything. Phase 2 asks `LegalHoldGuardPort`
(`_shared/ports/legal-hold-guard-port.ts`, injected at the composition root
`scripts/form-draft-purge.ts`) before the DELETE and skips the whole batch when the
descriptor is held. **Phase 1 is deliberately NOT gated** — it deletes nothing,
so it does not carry the permanent-loss risk that legal hold exists for.

`FORM_DRAFTS_LIFECYCLE_KEY` is exported by `module.ts` and **imported** by the purge —
do not rewrite the literal. If the descriptor key and the key the purge checks
differ, the hold **fails OPEN**: the purge finds no hold and deletes anyway,
with no error and no log.

## Verification

- `tests/form-draft-validation.test.ts` — denylist, key format, payload size.
- `tests/form-drafts-module.test.ts` — three-way drift guard (descriptor
  `module.ts` ↔ seed `sql/063` ↔ route guard), the lifecycle key pinned as a
  literal, FORCE RLS, and minimal `awcms_worker` grants (SELECT/UPDATE/DELETE,
  **no INSERT**). All three mutation classes have been proven RED.
- **There is no** `tests/integration/form-drafts.integration.test.ts` in this repo yet.
  Do not claim CRUD/RLS/idempotency have been tested end-to-end against a
  real Postgres — that gap is still open.

## Related skills

`awcms-idempotency` (submit), `awcms-abac-guard`, `awcms-data-lifecycle`
(descriptor/legal hold), `awcms-new-migration`, `awcms-wizard-form`
(READ-ONLY — the components do not exist yet).
