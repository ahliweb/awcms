# Derived-Application Compatibility, Deprecation, and Support-Window Policy

> **Status dokumen.** Repo `awcms` baru pada tahap fondasi ulang ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — belum ada modul ERP maupun tooling `extension:check` yang diimplementasikan. Mekanisme di bawah ini (enam skema versi independen, aturan bump MAJOR/MINOR/PATCH, kebijakan deprecation, gerbang enforcement) diwarisi langsung dari base awcms-mini yang sudah terverifikasi berjalan — reusable apa adanya untuk awcms. Referensi path file/skrip di bawah adalah **rencana lokasi** yang akan dibuat mengikuti pola yang sama, bukan file yang sudah ada di repo ini hari ini.

This document is the authoritative policy reference for every SemVer scheme a
derived application's `extension.manifest.json` declares itself against,
how a breaking change to any of them is communicated, and how long a
declared compatible range should be expected to remain valid. `bun run
extension:check` (`scripts/extension-check.ts`) is the machine
enforcement of this policy — this document is the human-readable
explanation of the rules it enforces.

## The six independent versioning schemes

AWCMS does not use one version number for everything — each scheme
below changes on its own schedule, for its own reason. Conflating them
(e.g. assuming a package release bump means the module contract changed)
is a common mistake this document exists to prevent.

| #   | Scheme                                                                            | Where it lives                                        | Bumped when…                                                                | Authoritative doc                                                                |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Package release (`package.json` `version`)                                        | This repository's own release                          | Any PR that changes application behavior (Changesets-driven)                | `09_roadmap_repository_commit.md` §Versioning (out of scope for this adaptation) |
| 2   | REST contract (`openapi/awcms-public-api.openapi.yaml` `info.version`)            | The OpenAPI document                                    | The REST contract SHAPE changes                                             | ADR-0008 (belum ditulis di awcms — akan diadaptasi dari awcms-mini)              |
| 3   | Event contract (`asyncapi/awcms-domain-events.asyncapi.yaml` `info.version`)      | The AsyncAPI document                                   | The event contract SHAPE changes                                            | ADR-0008                                                                          |
| 4   | Module descriptor contract (`MODULE_CONTRACT_VERSION`)                            | `src/modules/_shared/module-contract.ts`               | The `ModuleDescriptor`/`ApplicationModuleRegistry` TYPE shape changes       | ADR-0015 §1 (belum ditulis)                                                       |
| 5   | Capability contract (`CAPABILITY_CONTRACT_VERSIONS[key]`)                         | `src/modules/_shared/capability-contract-versions.ts`  | A specific capability's port interface (`_shared/ports/*.ts`) shape changes | ADR-0015 §1                                                                       |
| 6   | Manifest schema (`EXTENSION_MANIFEST_SCHEMA_VERSION`)                              | `src/modules/_shared/extension-manifest-contract.ts`   | The compatibility manifest's OWN field shape changes                        | ADR-0015 §1                                                                       |

Every scheme uses the same three-tier bump rule:

- **MAJOR** — a field/type is removed, renamed, or an optional field
  becomes required. Breaking. `bun run extension:check` fails a manifest
  whose declared version's MAJOR does not exactly match the actual
  current MAJOR for schemes 4-6, and fails a `compatibleAwcmsRange`
  (scheme 1) or `consumes.*ContractVersion` (schemes 2-3) that excludes
  the actual current version.
- **MINOR** — a new optional field/capability/endpoint/event is added.
  Backward-compatible. A manifest declaring a version whose MINOR is
  **less than or equal to** the actual current MINOR (same MAJOR) is
  always compatible — a derived application built against an OLDER minor
  never breaks against a NEWER one. A manifest declaring a HIGHER minor
  than what is actually shipped fails (`module_contract_version_unsupported`/
  `capability_version_unsupported`/`stale_api_contract_assumption`): it
  assumes a feature that does not exist yet.
- **PATCH** — documentation-only clarification, no shape change. Never
  checked for compatibility (any PATCH is always compatible with any
  other PATCH of the same MAJOR.MINOR).

## Deprecation policy

A scheme element (a module descriptor field, a capability, an API
operation/event channel, a manifest field) being **deprecated** means it
still works today but is scheduled for eventual removal in a future
MAJOR bump of its own scheme:

1. **Announce** — mark the element `deprecated: true` where the schema
   supports it (OpenAPI/AsyncAPI operations/schemas/channels — see
   `api-reference.md` §Compatibility & deprecation policy for the
   current list, auto-generated from the bundled contracts — out of
   scope for this adaptation until a real API exists) or document the deprecation explicitly in the owning file's
   doc comment (module descriptor fields, capabilities, manifest fields —
   these have no `deprecated` boolean in their own type shape today).
   Always accompanied by a changeset explaining the replacement path.
2. **Coexist** — the deprecated element and its replacement (if any) both
   work for at least one MINOR release cycle of the owning scheme, so a
   derived application has a window to migrate without an emergency
   patch.
3. **Remove** — only in a MAJOR bump of the owning scheme, never a MINOR
   or PATCH. `bun run extension:check` catches a derived application that
   has not migrated before the base moves to that MAJOR version (the
   manifest's declared version for that scheme stops satisfying the
   actual current one).

No fixed calendar SLA (e.g. "deprecated fields are removed after exactly
90 days") is imposed — awcms pre-1.0.0 package release policy (mengikuti
pola release awcms-mini, akan didokumentasikan saat skill/release process
awcms sendiri ditulis) already documents that "minor boleh memuat
penyesuaian belum stabil". The MAJOR/MINOR/PATCH discipline above is the
actual enforced guarantee once implemented; a MINOR release is never a
surprise breaking change regardless of how much or little time passed
since the deprecation announcement.

## Support-window guidance for `compatibleAwcmsRange`

A derived application's manifest should declare the NARROWEST range that
is still practically useful, not the widest one that happens to pass
today:

- **Prefer an open-ended lower bound with an explicit upper bound below
  the next anticipated MAJOR**, e.g. `">=0.1.0 <1.0.0"` — this is the
  same pre-1.0.0 fixture shape used by awcms-mini
  (`tests/fixtures/derived-application-example/extension.manifest.json`,
  to be mirrored in this repo once module extension tests exist). An
  upper bound that excludes a future MAJOR means `bun run
extension:check` fails LOUDLY (and early, before build) the moment a
  derived application is actually run against a base release that removed
  something it depends on — the entire point of this mechanism — instead
  of failing silently or subtly at runtime.
- **Widen the range only after actually verifying compatibility** with
  the newer base version (re-run `bun run extension:check` against the
  new checkout, review the relevant CHANGELOG/ADR entries for breaking
  changes, update `moduleContractVersion`/`capabilities.requires[].version`/
  `consumes.*ContractVersion` to match what was actually verified) — never
  widen a range preemptively "just in case it still works."
- **A derived application with NO manifest committed is not exempt from
  compatibility risk** — it simply is not machine-checked. Publishing
  `extension.manifest.json` is how a derived repository opts into this
  protection; this repository's own default build intentionally ships
  without one (see `scripts/extension-check.ts`'s own header, once
  written, for why that keeps a default base build green) precisely
  because the BASE has nothing external to be compatible with.

## Where this is enforced (not just documented)

`bun run extension:check` will be wired into three gates once
implemented, so an incompatible manifest actually blocks something
rather than only appearing in a report nobody reads (mirroring ADR-0015
in awcms-mini, to be adapted as an ADR here once the module system is
built):

1. `package.json`'s `check` composite (`bun run check`).
2. `.github/workflows/ci.yml`'s `quality` job, as an explicit named step.
3. `scripts/production-preflight.ts`'s stage list — a production
   deployment cannot proceed past an incompatible manifest.

## See also

- [`docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md`](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)
  — the rebuild decision this document's adaptation follows.
- `docs/adr/0015-derived-application-compatibility-manifest.md` (belum
  ditulis di awcms — akan diadaptasi dari awcms-mini bila/ketika modul
  eksternal/turunan menjadi relevan untuk platform ERP ini).
- `derived-application-guide.md` — the practical, step-by-step guide
  for a derived application author (out of scope for this adaptation;
  not applicable unless AWCMS itself becomes a base for derived apps).
- `tests/fixtures/extension-contract-incompatible/README.md` (belum
  ditulis) — eight concrete examples of exactly what each incompatibility
  class looks like in a real manifest, to be mirrored from awcms-mini.
