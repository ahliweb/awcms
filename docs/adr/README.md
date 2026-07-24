🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia (sumber)](README.id.md)

<!-- i18n-source-hash: sha256:b3fda03183b966cb9dfd1386874816a95acdf3cbe3c422eb032559522a7ab910 -->

# Architecture Decision Records (ADR)

This folder holds AWCMS's **architectural decision records** — one of the **three AWCMS-family templates used directly** — the ERP/back-office lineage, now the **online-first hybrid family superset** that absorbs awcms-micro's website/e-commerce cluster (see [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) & [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)). Every significant decision (architecture, runtime, contracts, security, or a deviation from the baseline standard) is recorded as one ADR file so the context and reasoning survive.

## Relationship to the awcms-mini reference repo

AWCMS was rebuilt (see [ADR-0001](0001-rebuild-on-awcms-foundation-erp-scope.md)) on the technical foundation of the modular monolith [`ahliweb/awcms-mini`](https://github.com/ahliweb/awcms-mini). This repo is **standalone** — it carries its entire foundation itself (it does not share a separate base), so foundation ADRs (runtime, RLS, ABAC, offline-first, API/event contracts, module admission) **live locally in this folder** as ADR-0002…0021, adapted from awcms-mini's reference ADRs. As of [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), `awcms-mini`, `awcms`, and `awcms-micro` are positioned as **three sibling templates used directly** (not a base-and-derivative hierarchy): `awcms` is the ERP/back-office lineage template. ADRs **specific to the ERP & business-integration scope** are added on top of that foundation.

> Numbering note: ADR-0001 in this repo is the **rebuild** decision. Its original framing ("ERP platform", ERP modules in `src/modules/`) was briefly **amended by [ADR-0022](0022-erp-modules-live-in-extension-repos.md)** (moving ERP modules to a separate extension repo), but ADR-0022 is now **superseded by [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)**: the AWCMS family are three direct-use templates and domain modules — ERP included — **may and should live directly in the used template's `src/modules/`**, not in a separate derived repo. The modular-monolith principles it establishes are adopted explicitly by ADR-0001 and detailed by foundation ADRs 0002–0021 plus [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Rules

1. One decision = one `NNNN-kebab-title.md` file (sequential number, zero-padded).
2. ADRs are **never deleted**. When a decision is replaced, the old ADR is marked `Status: Superseded by ADR-XXXX` and the new ADR references it.
3. Valid statuses: `Proposed`, `Accepted`, `Deprecated`, `Superseded`.
4. Changes to binding standards (see [`GOVERNANCE.md`](../../GOVERNANCE.md)) require an ADR.
5. Use the template at [`0000-template.md`](0000-template.md).

## Flow

```mermaid
flowchart LR
  P[Proposed] --> A[Accepted]
  A --> D[Deprecated]
  A --> S[Superseded]
  P --> R[Rejected / closed]
```

## Index

| ADR                                                                           | Title                                                                                                   | Status                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [0001](0001-rebuild-on-awcms-foundation-erp-scope.md)                         | Rebuild AWCMS as an ERP platform on a modular-monolith standard                                         | Accepted                                                                                                     |
| [0002](0002-bun-only-runtime.md)                                              | Bun-only runtime & tooling                                                                              | Accepted                                                                                                     |
| [0003](0003-postgresql-rls-multi-tenant.md)                                   | PostgreSQL + RLS for multi-tenant isolation                                                             | Accepted                                                                                                     |
| [0004](0004-rbac-abac-default-deny.md)                                        | RBAC + ABAC default-deny as the access baseline                                                         | Accepted                                                                                                     |
| [0005](0005-soft-delete-and-immutability.md)                                  | Soft delete for master/config, immutability for posted data                                             | Accepted                                                                                                     |
| [0006](0006-offline-first-sync-outbox.md)                                     | Offline-first + transactional outbox + HMAC sync                                                        | Accepted                                                                                                     |
| [0007](0007-openapi-asyncapi-contracts.md)                                    | OpenAPI & AsyncAPI as mandatory contracts                                                               | Accepted                                                                                                     |
| [0008](0008-independent-contract-and-module-versioning.md)                    | Independent versioning: package, API/event contracts, module descriptor                                 | Accepted                                                                                                     |
| [0009](0009-public-tenant-scoped-routes.md)                                   | Tenant resolution for public routes (sessionless)                                                       | Accepted                                                                                                     |
| [0010](0010-public-host-tenant-routing.md)                                    | Host/domain-based public tenant routing                                                                 | Accepted                                                                                                     |
| [0011](0011-capability-ports-for-cross-module-collaboration.md)               | Capability ports for cross-module collaboration                                                         | Accepted                                                                                                     |
| [0012](0012-module-admission-and-trusted-registry-boundary.md)                | Module admission categories & trusted static registry boundary                                          | Accepted                                                                                                     |
| [0013](0013-extension-layers-and-boundary-model.md)                           | Extension layers, tenant/business boundaries, service-extraction criteria                               | Accepted (derived pathway → [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md))   |
| [0014](0014-deterministic-build-time-module-composition.md)                   | Deterministic build-time module composition (base registry + derived apps)                              | Accepted (derived pathway → [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md))   |
| [0015](0015-derived-application-compatibility-manifest.md)                    | Derived-application compatibility manifest, test kit, semantic-version gates                            | Superseded → [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)                   |
| [0016](0016-organization-structure-module-admission.md)                       | Admission of `organization_structure` (Official Optional Business Foundation)                           | Accepted                                                                                                     |
| [0017](0017-document-infrastructure-module-admission.md)                      | Admission of `document_infrastructure` (Official Optional Business Foundation)                          | Accepted                                                                                                     |
| [0018](0018-data-exchange-module-admission.md)                                | Admission of `data_exchange` (Official Optional Business Foundation)                                    | Accepted                                                                                                     |
| [0019](0019-integration-hub-module-admission.md)                              | Admission of `integration_hub` (System Foundation)                                                      | Accepted                                                                                                     |
| [0020](0020-erp-extension-readiness-contracts.md)                             | ERP extension readiness contracts (business transaction, posting, period-lock, item, projection)        | Accepted                                                                                                     |
| [0021](0021-reference-data-module-admission.md)                               | Admission of `reference_data` (Official Optional Business Foundation)                                   | Accepted                                                                                                     |
| [0022](0022-erp-modules-live-in-extension-repos.md)                           | ERP domain modules live in extension repos, not the base (amends ADR-0001 point 3)                      | Superseded → [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)                   |
| [0023](0023-bilingual-docs-indonesian-source-english-default.md)              | Bilingual docs: Indonesian source, English default, staleness-gated                                     | Accepted                                                                                                     |
| [0024](0024-semver-numbering-continues-legacy-major-line.md)                  | SemVer numbering continues the legacy major line (jump to 5.0.0), not a reset to 1.0.0                  | Accepted                                                                                                     |
| [0025](0025-implement-deterministic-build-time-module-composition.md)         | Real implementation of deterministic build-time module composition in awcms (addendum to ADR-0014)      | Accepted (derived pathway → [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md))   |
| [0026](0026-modular-openapi-ownership-and-composition.md)                     | Modular OpenAPI contract: per-module ownership, deterministic bundle, derived-app fragment contribution | Accepted                                                                                                     |
| [0027](0027-mfa-totp-session-assurance-step-up.md)                            | MFA TOTP, recovery codes, session assurance (aal1/aal2), and step-up                                    | Accepted                                                                                                     |
| [0028](0028-oidc-sso-tenant-aware-account-linking-break-glass.md)             | OIDC/SSO tenant-aware, fail-closed account linking, SSRF guard, and break-glass                         | Accepted                                                                                                     |
| [0029](0029-deployment-profile-aware-turnstile-bot-protection.md)             | Deployment-profile-aware Cloudflare Turnstile bot protection (LAN/offline exempt)                       | Accepted                                                                                                     |
| [0030](0030-business-scope-hierarchy-generic-authorization-layer.md)          | Generic business-scope hierarchy authorization layer (multi-entity/unit)                                | Accepted                                                                                                     |
| [0031](0031-segregation-of-duties-conflict-enforcement.md)                    | Generic segregation of duties (SoD), exception/override, conflict enforcement                           | Accepted                                                                                                     |
| [0032](0032-family-compatibility-manifest-and-ci-conformance.md)              | Family compatibility manifest + CI conformance to the AWCMS-Mini standard                               | Accepted                                                                                                     |
| [0033](0033-abac-dynamic-policy-evaluator.md)                                 | Dynamic ABAC policy evaluator: bounded condition DSL, deny-overrides precedence, tenant-keyed cache     | Accepted                                                                                                     |
| [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) | AWCMS family = direct-use templates; derived-application pathway removed; no derivative repos           | Accepted                                                                                                     |
| [0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)            | `awcms` = online-first hybrid, ERP + integrated-SaaS ready, family superset (absorbs awcms-micro)       | Accepted (refines [0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) positioning) |

ADRs specific to the ERP-foundation & business-integration scope are added starting at the next number as decisions are made.
