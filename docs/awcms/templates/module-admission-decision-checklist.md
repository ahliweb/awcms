🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](module-admission-decision-checklist.id.md)

# Module admission decision checklist

> **Status (2026-07-14):** The `awcms` repo is only at the re-foundation stage (see
> [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> no ERP module has been implemented yet. This checklist is the review
> standard that applies the moment the first module PR is raised, adapted from the
> [awcms-mini](https://github.com/ahliweb/awcms-mini) base.

A ready-to-use checklist for PR reviewers (human or automated review skill)
adding/changing a new module, or adding a new external provider to an
existing module. Every point refers back to the module admission governance
document (planned: `docs/awcms/21_module_admission_governance.md`, the source
of truth) — this checklist summarises it, it does not replace it.

## A. Category & decision tree

- [ ] The category (System/Official Optional Module/ERP domain module/External
      Integration) has been determined through the decision tree, not
      assumed.
- [ ] If the proposal involves runtime code upload/install/marketplace/eval
      from any tenant/third-party input: this PR is **rejected** with no
      exception unless there is already a new ADR superseding the foundation
      ADR in force.

## B. Dependencies

- [ ] `ModuleDescriptor.dependencies` (lifecycle) only lists modules that
      genuinely must be active first — not call-time orchestration.
- [ ] No new cycle in the dependency graph (the
      `validateModuleDependencyGraph` test, or its equivalent, passes).
- [ ] Every `capabilities.consumes` entry explicitly marks `optional: true` or
      not, and the module README documents the degradation behaviour when
      that capability is unavailable.

## C. offline/LAN vs full-online-only compatibility

- [ ] The compatibility class (`offline-lan-safe`/`full-online-only`) is
      stated explicitly, not assumed.
- [ ] If `full-online-only`: there is a test/proof that the `offline-lan`
      profile stays 100% functional with this feature off (e.g.
      finance/inventory transactions can still be recorded locally).
- [ ] New config registry entries (the related env vars) are filled in with
      the correct deployment profile (all profiles vs online-only).

## D. External providers / data governance

Must be answered when the PR adds/changes an external provider adapter (payment
gateway, marketplace, tax/Coretax, logistics, etc.):

- [ ] Off-by-default: the `*_ENABLED` flag defaults to `false`, boot does not fail when
      the provider is off.
- [ ] Credentials come only from `process.env`/a secret manager — never from a
      tenant-controlled DB column, except for an exception already
      documented as an accepted risk with an equivalent written
      rationale.
- [ ] Outbound calls happen **outside** any DB transaction (the
      claim/call/finalize pattern).
- [ ] New provider URLs/hosts are validated against SSRF (do not resolve to a
      private/loopback/link-local IP, not vulnerable to DNS-rebinding) — do not
      assume it is safe just because the credentials come from env.
- [ ] There is a circuit breaker + timeout per provider key.
- [ ] Provider failure degrades gracefully — it does not block the core
      operational flow (e.g. transaction recording keeps working, syncing
      to the provider is deferred), and does not break the offline-first guarantees.
- [ ] Data sent to the provider has been minimized/masked per the data
      governance policy (NPWP/NIK/phone/email/sensitive financial data) —
      document which PII/sensitive data crosses the trust boundary
      and why it is needed.
- [ ] Data retention on the provider side is documented or declared N/A.
- [ ] Provider errors pass through the log redaction function before reaching the log
      (no raw secrets/PII/financial data in the log).
- [ ] Provider configuration changes (activation/deactivation, credential rotation)
      write an audit log (a high-risk action).
- [ ] Data-residency/subprocessor questions: where does the provider store the
      data, has its ToS/DPA been reviewed (governance, not code) —
      recorded as a reviewer note if not yet final.
- [ ] If the module touches financial/tax data: there is an append-only
      audit trail for changes (not a silent overwrite), and compliance
      validation (e.g. tax invoice/Coretax format) has been reviewed by the
      responsible party.
- [ ] The applicable security review skill/process has been run and its
      result is attached to the PR.

## E. Ownership & lifecycle

- [ ] The new module sets `type` in `module.ts` according to the agreed
      category (`system`/`domain`).
- [ ] The initial lifecycle status makes sense (`experimental` for a new feature that
      is not mature yet, `active` when it is production-ready) — not straight to
      `active` without consideration.
- [ ] The owner (CODEOWNERS, or `maintainers` when filled in) is clear.

## F. Deprecation/removal (when this PR deprecates/removes another module)

- [ ] The descriptor status is changed to `deprecated` with a changeset that
      explains the migration path and the target removal version.
- [ ] Posted/append-only data belonging to the deprecated/removed module is never
      deleted silently — there is an explicit archive/retention plan (ERP
      finance/audit data often carries a legal retention obligation, check that first
      before deciding the deprecation window).
- [ ] There is a minimum deprecation window (recorded in the changeset) before the code +
      tables are actually removed, and no tenant/entity is still
      `enabled` on that module without notice.
- [ ] The related API/event changes (routes removed, events no longer
      published) are reflected in OpenAPI/AsyncAPI and in a `major`-bump
      changeset (breaking change, SemVer).

## G. Documentation & contracts

- [ ] OpenAPI updated when the module adds an endpoint.
- [ ] AsyncAPI updated when the module adds/changes an event.
- [ ] A new migration exists when the schema changes, with RLS + FK indexes, AND there is
      an integration test proving tenant isolation genuinely fails safe
      (cross-tenant queries are rejected) — not just a declared
      `FORCE ROW LEVEL SECURITY` with no test exercising it.
- [ ] A changeset is added.
- [ ] The module README documents the purpose, tables, endpoints, events,
      dependencies, and (when relevant) external providers + their
      degradation behaviour.
