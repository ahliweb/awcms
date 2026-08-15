🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0012-module-admission-and-trusted-registry-boundary.id.md)

# ADR-0012 — Module admission categories and the trusted static registry boundary

- **Status:** Accepted
- **Date:** 2026-07-12
- **Decision makers:** @ahliweb
- **Related:** Issue #696 (epic #679, platform-hardening), Issue #510 (epic Module Management), `docs/awcms/21_module_admission_governance.md` (full detail), ADR-0001, ADR-0002, ADR-0008, ADR-0011

> **Currency note (2026-07-13).** The "14 modules" figure in the Context/Decision
> below is a snapshot from when this ADR was Accepted (Issue #696) and is
> **deliberately not updated here** — per the `docs/adr/README.md` policy:
> an Accepted ADR is not silently rewritten when facts shift, only through a
> new/superseding ADR. The number of registered modules has already grown
> since then (16 modules, confirmed by `bun run
modules:dag:check`); the current figure and the category mapping of the two
> newer modules (`social_publishing`, `idn_admin_regions`) are in
> `docs/adr/0013-extension-layers-and-boundary-model.md` §1 and
> `docs/awcms/21_module_admission_governance.md` §8 — consult both
> for the current numbers, not the numbers below.

## Context

The module registry (`src/modules/index.ts`) grew from a generic base to 14
registered modules, including two real domain modules (`blog_content`,
`news_portal`) which were previously documented as the "single
exception" (`AGENTS.md` §Module map) — there are now two, and the roadmap
names region/Hermes modules next. Without explicit admission criteria, it is
not clear when a new capability may enter this base repo, which category
applies (and the dependency/security-review/ownership/deprecation rules that
follow from it), or where the hard boundary against third-party code executed
at runtime lies.

## Decision

We decide:

1. **Five module categories**: Core, System, Official Optional Module,
   Derived Application, External Integration — the full definitions, the
   admission decision tree, the per-category criteria, the dependency rules
   (required vs optional capability), the offline/LAN vs full-online-only
   compatibility expectations, the security review checklist, ownership,
   and the deprecation/removal policy live in
   `docs/awcms/21_module_admission_governance.md` — this document
   summarises the binding decision, it does not duplicate the detail.
2. **The registry stays trusted and static** — `src/modules/index.ts` is
   the only source of modules, compiled into a single monolith binary, reviewed
   through normal PR + CI. `awcms_tenant_modules` only stores the
   enable/disable boolean for code that ALREADY EXISTS in the running
   binary; it never loads/executes new code at runtime.
3. **Explicit prohibitions**: a module marketplace, tenant plugin/theme/script
   upload, dynamic import from a path/URL originating from tenant/user
   input, or `eval`/`Function()` executing external text —
   are not introduced and will not be introduced without a new ADR that
   explicitly supersedes ADR-0001 (modular monolith) and/or
   ADR-0002 (Bun-only runtime with no sandbox for executing foreign code).
4. The 14 currently registered modules are mapped onto the categories above (3 Core, 9
   System, 2 Official Optional Module, 0 Derived Application/External
   Integration top-level) — see doc 21 §8 for the full table and the
   remediation (`type`/`isCore`/`maintainers` field gaps) detected
   during this mapping.
5. A lightweight proposal (`docs/awcms/templates/
module-proposal-template.md`) and a review checklist
   (`docs/awcms/templates/module-admission-decision-checklist.md`)
   are added as an initial triage ahead of a full ADR for a new module.

## Consequences

- **Positive:** a contributor (human or agent) has an explicit decision tree
  to decide whether a new capability belongs in this base or in a derived
  application, which category applies, and which checklist it must
  pass — reducing the ambiguity that was previously only implicit from
  reading the existing module code one by one.
- **Positive:** the prohibition on runtime code execution/marketplace is now
  documented explicitly as a conscious decision, not merely "not
  built yet" — future proposals heading that way have a clear
  rejection bar (a new ADR superseding ADR-0001/0002) instead of
  being discussed from scratch every time they are raised.
- **Negative/trade-off:** this document is purely governance/documentation —
  the remediation gaps detected while mapping the 14 modules (the `type` field
  inconsistently filled, `isCore` present in only one module, `maintainers` never
  filled) are NOT fixed in code by this ADR/PR, only recorded
  as follow-up (doc 21 §8) — the risk of drift between the document and the code
  remains until that follow-up is done.
- **Neutral:** the "Derived Application" and "External Integration" categories
  are defined but have no top-level entry in this base registry
  today (External Integration lives as a sub-component of the owning module,
  a Derived Application is always outside this repo) — this decision does not
  change the `ModuleType` union or add any new registry entry at
  all.

## Alternatives considered

- **Leave admission implicit, just rely on manual code review** —
  rejected: epic #679 explicitly flags the lack of explicit admission
  criteria as a risk before new product modules (region/Hermes)
  enter the base; manual review without written criteria is not consistent across
  reviewers/over time.
- **Build a real plugin/marketplace system now, with an execution
  sandbox** — explicitly rejected: it directly contradicts ADR-0001
  (trusted modular monolith) and ADR-0002 (Bun-only, no sandbox for
  executing foreign code); there is no concrete business need today that
  justifies that much complexity and attack surface.
- **Add an explicit `"core"` value to the `ModuleType` union now** —
  deferred: changing the type (`_shared/module-contract.ts`) and refilling
  9+ descriptors at once exceeds the docs-only scope of Issue #696 (atomic);
  recorded as remediation R1 (doc 21 §8) for a separate code issue.
