---
"awcms": minor
---

Port the `form_drafts` module from awcms-micro (Issue #484) — row 1 of Gelombang 1 in `docs/awcms/absorb-awcms-micro-roadmap.md`. Net-new and additive: nothing existing changes behaviour, the module DAG stays acyclic (`dependencies: ["identity_access"]`), and nothing consumes it yet.

A generic, **domain-agnostic** server-side draft store for multi-step forms. One table holds an opaque JSONB payload plus the coordinates needed to resume it (`module_key`, `wizard_key`, `resource_type`, `resource_id`, `current_step`); what the payload MEANS stays owned by whichever module created it. `type: "system"` — shared platform mechanism, like `logging` and `data_lifecycle`.

- **Migrations `062` (schema) + `063` (permissions).** `awcms_form_drafts`, `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation`, four indexes covering the resume/expire/purge/dry-run query paths. `awcms_worker` gets exactly SELECT/UPDATE/DELETE — no INSERT, since the purge job never creates a draft. Four permissions (`draft.{read,create,update,delete}`).
- **Endpoints** under `/api/v1/form-drafts` — list/create, get/patch/delete, and submit. Submit requires an `Idempotency-Key`; create deliberately does not, because a retried create costs one deletable scratch row while a retried submit hands the payload to a domain action twice. Requiring a key everywhere would just train callers to generate throwaway ones.
- **Payload safety.** 32 KB ceiling, and any key at any nesting depth resembling a secret (`password`/`token`/`secret`/`credential`/`apiKey`/`privateKey`) is **rejected outright, never silently redacted** — a caller who gets a 200 back must not have to wonder whether a field was stripped.
- **No `submit` permission.** Submit guards on `draft.update`; a separate action would widen the `AccessAction` union and plant a latent-authz trap, since an action nobody seeds into a role denies even the tenant owner while looking correct in review.
- **Two-phase retention** via `bun run form-drafts:purge`: expire overdue drafts to `status='expired'` (a transition, not a delete), then physically purge `expired`/`abandoned` rows past the cutoff (default 30d). Both bounded and self-auditing.
- **Legal-hold enforcement lives in this module, not in the engine.** The `data_lifecycle` descriptor is `delegated`: that engine only READS this table for backlog visibility and never mutates it, so a hold enforced only there would stop nothing. The real gate is in `purgeExpiredFormDrafts`, which asks the injected `LegalHoldGuardPort` before its DELETE and skips the batch when held. Phase 1 is deliberately ungated — it deletes nothing.

Verified: `tests/form-draft-validation.test.ts` (18) plus a new `tests/form-drafts-module.test.ts` (12) whose drift guards were **mutation-proven red** — renaming the lifecycle key, dropping `FORCE ROW LEVEL SECURITY`, and over-granting the worker each fail the suite. One assertion was rewritten after the first mutation run showed it was tautological (both sides read the same constant, so a rename kept it green); the descriptor key is now pinned as a literal, because a rename silently orphans every legal hold already recorded against the old key.

Not included, and not claimed: awcms-micro's wizard COMPONENT library (`src/components/ui/`) is a separate, still-open Gelombang-0 row, and there is no integration test against a real PostgreSQL for this module yet.
