---
name: awcms-erp-extension-readiness
description: READ-ONLY / HISTORICAL (ADR-0034) — the base ERP extension readiness contracts (`_shared/business-transaction-contract.ts`/`_shared/erp-reference-data-contract.ts`/`_shared/ports/period-lock-port.ts`) AND the derived-application pathway this skill assumes have BEEN REMOVED. ERP is now built as a `domain` module DIRECTLY in `src/modules/` (the same pattern as every other base module), not a derived repo; the contract files & the `example-erp-extension` fixture referenced here no longer exist. Historical reference from Issue #755, epic #738 platform-evolution Wave 4, ADR-0020 — superseded by ADR-0034.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — ERP Extension Readiness

> **READ-ONLY / HISTORICAL — this skill's premise was revoked by ADR-0034
> (2026-07-21).** ADR-0034 (`docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`)
> **removed the derived-application pathway** and, with it, the **base ERP
> extension readiness contracts** this skill teaches you how to use/evolve.
> What no longer exists in this repo (verify: the files below are not found
> in `src/`):
>
> - `src/modules/_shared/business-transaction-contract.ts`
> - `src/modules/_shared/erp-reference-data-contract.ts`
> - `src/modules/_shared/ports/period-lock-port.ts`
> - the fixture `tests/fixtures/derived-application-example/modules/example-erp-extension/`
>   (the whole `derived-application-example/` directory was replaced by
>   `tests/fixtures/example-domain-modules/`, and `example-erp-extension` was deleted)
> - `src/modules/application-registry.ts` and the `bun run extension:check` command
>   (deleted along with the derived pathway)
>
> **The new direction.** ERP is no longer built in a derived repo. This template
> is used DIRECTLY ("templates are used-directly"); the family under development
> is now TWO repos — `awcms` + `awcms-astro` (ADR-0055, ADR-0070), with
> `awcms-mini`/`awcms-micro` as ARCHIVES. An
> ERP module is now built as a `type: "domain"` module DIRECTLY in
> `src/modules/` of this repo — the same pattern as every other base module (the
> real example of the first website module ported directly: `theming`, skill
> `awcms-theming`). To scaffold a new domain module use the `awcms-new-module`
> skill; for composition governance use `awcms-module-management`. ADR-0034
> supersedes ADR-0013/0020 on this point (the base ERP extension readiness
> contracts) and ADR-0014/0015/0025 (the derived pathway).
>
> The content below is kept **only as a historical reference** to the ERP
> invariants (posted immutable, fail-closed period lock, tenant-as-boundary) that
> remain conceptually relevant when building a domain ERP module — but the file
> names, fixtures, and commands it references are NO LONGER VALID. Do not use it
> as an implementation guide that can be executed today.

Sources of truth: `docs/adr/0020-erp-extension-readiness-contracts.md`
(binding architectural decision), `docs/awcms/erp-extension-
contracts.md` (technical reference for the eleven contract families —
ownership/versioning/failure-semantics/privacy/example per contract),
`src/modules/_shared/business-transaction-contract.ts`,
`src/modules/_shared/erp-reference-data-contract.ts`,
`src/modules/_shared/ports/period-lock-port.ts`,
`tests/fixtures/derived-application-example/modules/
example-erp-extension/` (the complete reference fixture).

**This base is not an ERP.** There is no chart of accounts/journal/general
ledger/inventory valuation/sales-purchase-order/AR-AP/payroll/tax here,
and there never will be (ADR-0013 §1). This skill does NOT teach you how
to build accounting logic — it teaches you how to consume (or, if you are
working on a base issue itself, how to evolve) the NEUTRAL contracts that
an external ERP extension implements.

## When to use this skill

1. **Building an ERP extension** in your own derived repository — read
   §Consumption playbook below.
2. **Adding a new contract family** to this base itself (rare — only
   when a new base issue explicitly asks for it) — read
   §Base contract evolution playbook.
3. **Changing `PeriodLockPort`/`business-transaction-contract.ts`/
   `erp-reference-data-contract.ts`** — read §Invariants that must not be
   loosened first.

## Consumption playbook (building an ERP extension in a derived repository)

1. Read `docs/awcms/erp-extension-contracts.md` — the table of eleven
   contracts, which are NEW (business transaction, posting event,
   period lock, item/currency/UoM/inventory/reconciliation) vs which
   REUSE an existing Wave 2/3 mechanism (party
   directory, business-scope hierarchy, document numbering, reporting
   projection) — do not duplicate what already exists.
2. Assemble your own `ApplicationModuleRegistry` (Issue #740/#741, doc
   `derived-application-guide.md`) — your ERP module `dependencies` on
   the base Core (`tenant_admin`, `identity_access`) like any ordinary
   derived module, THEN optional `capabilities.consumes` on `party_directory`
   (`profile_identity`) and/or `organization_hierarchy_resolution`
   (`organization_structure`) if you need party/scope references —
   see `tests/fixtures/derived-application-example/modules/
example-erp-extension/module.ts` for the exact example.
3. Implement your own `PeriodLockPort` (the base provides no adapter
   with real behaviour at all — only
   `noPeriodLockAdapterConfigured`, which is ALWAYS `checked: false`). Your
   posting engine MUST treat `checked: false` identically to
   `locked: true` for a `"post"` operation — see `tests/fixtures/
derived-application-example/modules/example-erp-extension/
posting-engine.ts` for the correct fail-closed pattern.
4. Register your own event types (`"<extension_key>.posting.
requested"`/`"...result_recorded"`) on top of `domain_event_runtime`
   (Issue #742) in your own build — the payloads have the shape
   `AccountingPostingRequestPayload`/`AccountingPostingResultPayload`.
   The base NEVER interprets `totalDebit`/`totalCredit`/
   `ledgerReference` — they are all decimal-as-string/opaque.
5. Enforce idempotency per `requestId` (ADR-0020 invariant #4) — the
   same request sent again must return an identical result, never a
   double posting. **Not sufficient on its own** —
   ALSO enforce posted-state uniqueness per `(tenantId, transactionType,
externalTransactionId)` (invariant #3), independent of `requestId`:
   a NEW `requestId` for the SAME business transaction must still be
   rejected as a duplicate, not accepted as a second independent
   posting (Medium security-auditor finding on PR #789 — the initial
   fixture deduplicated per `requestId` only).
6. Enforce reversal-as-a-new-transaction (invariant #2) — NEVER
   change/overwrite a transaction row that is already `"posted"`; a
   correction is always a new request with a `reversalOfExternalTransactionId`
   referencing the original transaction's `externalTransactionId` — NEVER
   its `requestId` (a different ID space). Reversal target resolution
   MUST be scoped to the AUTHENTICATED tenant/legal-entity of the
   reversal request (invariant #7) — explicitly re-verify the resolved
   original transaction's `tenantId`/`legalEntityScope`, do not merely
   rely on the structure of the index key (High security-auditor finding on PR
   #789 — the initial fixture indexed by `requestId`, the wrong ID
   space, and did not re-verify tenant/legal-entity at all
   — see `posting-engine.ts`'s corrected implementation for the
   right pattern).
7. If you want to contribute a `reporting` projection (Issue #753):
   your descriptor MUST enforce its own `requiredPermission` at
   your read endpoint — do not merely declare the field
   (see the "descriptor field documented but not
   enforced" note in `erp-extension-contracts.md` §11, a pattern that recurs
   throughout this Wave 3 epic).
8. `bun run extension:check` from your derived repository (the same schema
   as this base) to validate your compatibility manifest.

## Base contract evolution playbook (adding a new contract family here)

Only do this when a new base issue explicitly asks for an additional
contract (do not add contracts "just in case").

1. Decide whether the new contract is a **passive data type** (put it in
   `_shared/erp-reference-data-contract.ts` or
   `_shared/business-transaction-contract.ts`, with no methods/behaviour)
   or a **behavioural port** (a new file `_shared/ports/<name>-port.ts`,
   which MUST: import nothing from any module, have `async` methods taking
   an explicit `tx: Bun.SQL` as their first parameter, and — where
   relevant — a fail-closed default adapter such as
   `noPeriodLockAdapterConfigured`).
2. **Do not duplicate a contract another module already owns** — check
   first whether `party-directory-port.ts`/`business-scope-hierarchy-
port.ts`/`document_infrastructure`'s numbering/`ProjectionDescriptor`
   already covers your need before writing a new contract (four
   of the eleven contracts in issue #755 reuse an existing
   mechanism, and that is no accident — check before creating something new).
3. Update `docs/awcms/erp-extension-contracts.md`'s table + the
   per-contract section (ownership/versioning/failure-semantics/privacy/example)
   — do not leave a new contract without an entry in that document.
4. Add to/extend `tests/fixtures/derived-application-example/modules/
example-erp-extension/` to prove the new contract can actually be
   implemented (not just a TypeScript type nobody has ever
   used) — the same pattern `posting-engine.ts`/
   `period-lock-adapter.ts` already established.
5. `bun run typecheck && bun test tests/unit/erp-extension-contracts.test.ts
tests/unit/module-composition-fixture.test.ts` before the PR.
6. If the decision is binding across documents (a new dependency direction,
   a new invariant), update ADR-0020 — do NOT just add code without
   updating the architectural decision behind it (doc 21 §9 has an
   explicit note: a pure contract with no new module still needs an ADR,
   not a module template proposal).

## Invariants that must not be loosened

- **Posted immutable** — no function anywhere in the base may
  "helpfully" update the `status: "posted"` field of a
  `BusinessTransactionReference` in place.
- **Fail-closed period lock** — `checked: false` MUST weigh exactly as
  much as `locked: true` for `"post"`. Never add a path that
  treats "cannot check" as "just allow it".
- **The tenant remains the security boundary** — `legalEntityScope`/`periodKey`/etc.
  are NEVER a substitute for RLS/ABAC; period lock and business
  scope are both explicitly documented as "not an identity
  boundary".
- **No hard dependency on `reference_data`** — historically, Issue #750
  was still OPEN with an unfixed Critical finding when these contracts were
  first written (per ADR-0020 §Status at the time); Issue #750 is now CLOSED
  and `reference_data/module.ts`'s `status` is now `"active"`. The design
  decision holds regardless of that historical status:
  `ItemReference`/`CurrencyReference`/`UnitOfMeasureReference` are
  deliberately independent of their data source. Do not add an import of
  `reference_data` to `_shared/erp-reference-data-contract.ts` without
  re-verifying that module's security status first.

## Verification

- `bun run typecheck`
- `bun test tests/unit/erp-extension-contracts.test.ts
tests/unit/module-composition-fixture.test.ts
tests/unit/extension-check-fixtures.test.ts`
- `bun run repo:inventory:check` (when the test/file count changes)
- a full `bun run check` before the PR (docs-only + TypeScript contracts +
  fixture, with no new migration/endpoint — do not assume
  `db:migrate`/`api:spec:check` need to change unless you really are
  adding a new table/route to the base).
