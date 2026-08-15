🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](derived-app-pilot-plan.id.md)

# First Derived Application Pilot Plan

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** The derived-application-in-a-separate-repo model is REVOKED — the AWCMS family (`awcms-mini`/`awcms`/`awcms-micro`) is now a set of **used-directly** templates, with no derivative repo created (develop modules directly in the template). This document is kept as a historical record.

Issue #465. The AWCMS base is stable (v0.23.5, 18 doc06 backlog issues +
the post-backlog M9 epic complete) and `derived-application-guide.md` already
explains how to build a derived application on top of it. This document
picks **one first real pilot** to validate that pattern through a genuine
use case, without mixing any business domain into the base.

> **This document changes no code.** No domain module is added to this
> base's `src/modules/`, no base migration/OpenAPI/AsyncAPI is changed, and
> this document **does not** execute any change in the recommended derived
> repo — it only plans and recommends the next steps.

## Candidate matrix

Five candidates from `derived-application-guide.md` §Derived application
examples, scored on a scale of 1 (low) - 5 (high) for each criterion
(a higher score = a better fit for a first pilot, except the risk column
which is the other way round — lower risk is better for a first pilot):

| Candidate                                 | Business need | Security/privacy risk (lower is better)                          | Data complexity                        | Platform validation value | Implementation readiness                                    | AhliWeb/AWCMS relevance                             |
| ----------------------------------------- | ------------- | ---------------------------------------------------------------- | -------------------------------------- | ------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| **AWPOS** (retail/POS)                    | 5             | 2 (transaction/payment data, not health/sensitive personal data) | 4 (catalogue, stock, transaction, tax) | 5                         | **5 — repo + 38 doc06 issues + GitHub setup already exist** | 5 — the source of this base document's own standard |
| Satu Sehat Kobar (internal health)        | 3             | 5 (health record data — heavily regulated)                       | 4                                      | 3                         | 1 (no planning/repo yet)                                    | 3                                                   |
| Health Facility Quality Management System | 3             | 3 (incident/audit data, not medical records directly)            | 3                                      | 3                         | 1 (no planning/repo yet)                                    | 3                                                   |
| Smart School Portal                       | 3             | 4 (data on minors, grades)                                       | 3                                      | 3                         | 1 (no planning/repo yet)                                    | 2                                                   |
| Public Complaints System                  | 3             | 4 (complainant data, can be politically/legally sensitive)       | 2                                      | 3                         | 1 (no planning/repo yet)                                    | 2                                                   |

The "Implementation readiness" criterion is the sharpest differentiator: the
four candidates other than AWPOS are still purely illustrative (the module
names in `derived-application-guide.md` are examples; there is no real
planning or repo whatsoever). AWPOS, by contrast, already has:

- A real GitHub repo: [`ahliweb/awpos`](https://github.com/ahliweb/awpos),
  with `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`, and the document set
  `docs/awpos/01`-`19` — **exactly the same** document structure as
  `docs/awcms/01`-`19` in this repo.
- **38 GitHub issues already created** (`Issue 0.1` through `Issue 12.2`, milestones
  M0-M8), all `OPEN` (implementation has not begun — the AWPOS repo is still
  docs-only per its `AGENTS.md`: "No application code yet. Implementation
  starts at Issue 0.1").
- Label/milestone/security setup (Dependabot, CodeQL, etc.) already
  configured — the identical pattern to the one applied in this repo.

## Key fact: the AWPOS document set is where this base came from

This is no coincidence — `docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`
records that AWCMS was totally refactored on 2026-07-04 following the AWPOS
document set as the **source of truth for the standard**, extracting 18 of the
38 AWPOS doc06 issues that are generic (foundation, tenant/identity,
sync, reporting, logging/security, setup wizard) into this modular
monolith base, while the remaining 20 issues (retail/POS-specific domain)
were closed `not planned` in this base repo with the note "moved to the
example derived application (e.g. AWPOS)".

Practical consequence: **18 of the 38 issues in the `ahliweb/awpos` repo are
now done generically** — not by reimplementing them in AWPOS, but by
making AWCMS the base/dependency of AWPOS. Direct mapping (AWPOS issue
number, title identical to the issue already `completed` in this base):

| AWPOS issue (\#, title)                  | Status in the AWCMS base                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #1 Issue 0.1, #2 Issue 0.2, #3 Issue 0.3 | Foundation skeleton, migration runner, OpenAPI/AsyncAPI baseline — already exist as this base itself                          |
| #6-#9 Issue 2.1-2.4                      | Tenant/office, central profile, identity login, RBAC/ABAC — `src/modules/tenant-admin`, `profile-identity`, `identity-access` |
| #21-#23 Issue 6.1-6.3                    | Sync outbox/inbox, conflict tracking, R2 object sync queue — `src/modules/sync-storage`                                       |
| #28 Issue 8.1, #31 Issue 9.1             | Admin layout shell, management reporting views — `src/modules/reporting` + admin shell                                        |
| #33-#35 Issue 10.1-10.3                  | Structured logging/audit, connection pooling, security readiness — `src/modules/logging` + `scripts/`                         |
| #36 Issue 11.1                           | Workflow approval engine — `src/modules/workflow-approval`                                                                    |
| #37-#38 Issue 12.1-12.2                  | Setup wizard, offline/LAN deployment profile — `tenant-admin` + `deployment-profiles.md`                                      |

**The remaining 20 AWPOS issues that really are domain-specific** (no
counterpart in the base, and rightly so — this is pure retail/POS domain):
#4-#5 (1.1-1.2 legacy data migration), #10-#13 (3.1-3.4
catalogue/stock/checkout/POS transaction), #14-#17 (4.1-4.4 warehouse), #18-#20
(5.1-5.3 receipt PDF/WhatsApp/email), #24-#27 (7.1-7.4 tax profile/VAT/Coretax),
#29-#30 (8.2-8.3 cashier UI + customer portal), #32 (9.2 AI business
analyst).

This means the AWPOS pilot **does not start from zero** — the real work left
is the 20 domain-specific issues above, done on top of AWCMS as the
base/dependency, not 38 issues from scratch.

## Recommendation

**AWPOS is recommended as the first derived application pilot.** Reasons:

1. The lowest security/privacy risk of the five candidates (retail
   transaction data, not health/children's/complaint data that is more
   sensitive under regulation) — a good fit for a first pilot that validates
   the pattern, rather than high-risk production.
2. Implementation readiness far above the other candidates: repo, docs 01-19,
   38 issues, milestones, and the GitHub security setup already exist — no
   planning from scratch needed.
3. Highest relevance: AWPOS is the source of this base's own standard
   documents, so validating AWPOS automatically validates that this base
   really is general-purpose (rather than silently still assuming a POS
   domain behind it).
4. The real work scope is already trimmed to 20 domain-specific issues (see
   above), not 38 — the pilot can start from a small slice and quickly
   demonstrate real validation.

## PRD/SRS outline

The full PRD/SRS **already exists** at
`/home/data/dev_bun/awpos/docs/awpos/02_prd_detail_per_modul.md` (PRD) and
`03_srs_detail_per_modul.md` (SRS) — this document does not duplicate it,
it only summarises for pilot-decision context:

- **Personas**: Owner, Admin, Cashier, Warehouse Staff, Tax Officer, CRM
  Staff, Business Analyst, Customer, Technical Admin.
- **PRD modules**: Tenant Admin (already covered by the base), Catalog, Inventory/
  Warehouse, POS/Checkout, CRM/Receipt, Tax/Coretax, Reporting/AI (extra
  views on top of the base), Sync (already covered by the base), Observability/
  Deployment (already covered by the base).
- Recommended follow-up for the AWPOS repo: re-review doc
  02/03 for the modules that **are** already covered by the base (Tenant Admin, Sync,
  Observability) to make sure their descriptions stay consistent with this
  base's implementation, rather than being reimplemented.

## Domain modules & the base vs derived boundary

| Stays in the base (AWCMS — do not change)                                             | New AWPOS domain module (derived repo)                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Identity/tenant/RBAC/ABAC/RLS (`identity-access`, `profile-identity`, `tenant-admin`) | `catalog` — products, categories, prices                                             |
| Sync outbox/inbox/conflict/object queue (`sync-storage`)                              | `inventory` — stock, lot/batch/serial, warehouse, transfer, cycle count              |
| Audit/logging/pooling/security readiness (`logging`, `scripts/`)                      | `pos-checkout` — cart, checkout session, idempotent transaction posting              |
| Workflow approval engine (`workflow-approval`)                                        | `crm-receipt` — PDF receipt, WhatsApp (StarSender), email (Mailketing) delivery      |
| Reporting base + admin shell (`reporting`)                                            | `tax-coretax` — tax profile, VAT invoice staging, Coretax XML batch export           |
| Setup wizard, deployment profiles                                                     | `reporting-ai` — retail-specific extra views, AI business analyst safe views/tools   |
| —                                                                                     | UI: fullscreen Cashier POS, Customer receipt portal (on top of the base admin shell) |

The principle is the same as `derived-application-guide.md` §Base reusable vs
domain-specific: the left column is reused unchanged; the right column is new
modules that follow the base's existing RLS/ABAC/audit/idempotency patterns
(see also
[`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
for a concrete example of the one-domain-module pattern).

## Initial atomic issue list (AWPOS derived repo)

Concrete recommendations for maintaining `ahliweb/awpos` (not executed
by this issue #465):

1. **Close the 18 issues already covered by the base** (#1-#3, #6-#9, #21-#23,
   #28, #31, #33-#36, #37-#38) with reason `not planned`/`duplicate`, with a
   note pointing at the equivalent base module — symmetric with how
   this base closed its own 20 domain-specific issues and pointed back
   at AWPOS.
2. **Add AWCMS as the base/dependency** of AWPOS (fork, git
   subtree, or restart the repo from this base — a technical decision outside
   this document's scope, to be discussed separately by the AWPOS repo owner).
3. **Start from the first quickly-validated slice**, in a
   dependency-respecting order over the 20 domain-specific issues:
   - #4-#5 (1.1-1.2) — a retail-specific legacy migration toolkit (if there is
     old data to import; skip if there is none).
   - #10-#13 (3.1-3.4) — **POS MVP**: product catalogue, stock, checkout,
     idempotent transaction posting. This is the fastest-validated slice: the
     first end-to-end domain module (migration+RLS, ABAC, endpoint, basic UI)
     on top of the existing base.
   - #14-#17 (4.1-4.4) — warehouse (zone/bin, lot/batch/serial, transfer,
     cycle count) once the POS MVP is stable.
   - #18-#20 (5.1-5.3) — receipt PDF/WhatsApp/email, using the base's existing
     sync outbox for async delivery.
   - #24-#27 (7.1-7.4) — tax/Coretax readiness.
   - #29-#30 (8.2-8.3) — fullscreen cashier UI, customer portal.
   - #32 (9.2) — AI business analyst safe views/tools.
4. Every issue still follows the 9-step flow of
   `derived-application-guide.md` (migration+RLS → seed ABAC → endpoint+
   OpenAPI/event+AsyncAPI → UI → audit → layered tests → deployment).

## Security, testing, deployment, handover checklist

Derived from `derived-application-guide.md` §Practical security &
compliance checklist, plus AWPOS-specific points:

**Security**

- [ ] Tenant context/RLS FORCE for every new domain table (catalogue,
      stock, transaction, tax profile, etc.).
- [ ] ABAC default-deny for every new per-domain-module permission.
- [ ] Idempotency-Key mandatory for transaction posting (3.4) and Coretax
      export (7.4) — both high-risk mutations that must be safe to repeat.
- [ ] Redaction of sensitive data: card number/payment method, NPWP/NIK on the
      tax profile, customer contact numbers on CRM/receipt.
- [ ] Payment/tax data audited via `recordAuditEvent` (transaction posted/
      cancel/return, tax export, price change).

**Testing**

- [ ] Unit tests for pure domain logic (stock, tax, price calculations).
- [ ] Integration against a real PostgreSQL for every new domain
      endpoint (not a mock) — the same pattern as this base's integration tests.
- [ ] Contract: `api:spec:check` for AWPOS's own OpenAPI/AsyncAPI.
- [ ] Security: test that RLS FORCE and ABAC default-deny fail correctly
      (not just the happy path).

**Deployment**

- [ ] Pick a deployment profile (`deployment-profiles.md`): LAN-first
      (`docker-compose.yml`) for a single-outlet/offline retail operator,
      or registry-based (`Dockerfile.production` + the
      [`deploy-coolify.md`](deploy-coolify.md) guide) for an online
      multi-outlet deployment.
- [ ] `bun run production:preflight` green before go-live in every
      environment.

**Handover**

- [ ] Operator documentation (cashier SOP, warehouse SOP, tax export SOP) —
      the AWPOS `08_sop_operasional_user_guide.md` pattern already exists, review
      it again after the real implementation to make sure it stays accurate.
- [ ] A backup/restore drill run at least once before go-live
      (see the base's `deploy/backup/README.md`).
- [ ] The technical contact/owner of AWPOS after the pilot named explicitly
      before it counts as done as a platform validation.

## See also

- [`derived-application-guide.md`](derived-application-guide.md) — the 9-step
  flow, the base-reusable vs domain-specific table, five illustrative examples.
- [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
  — a concrete example of one minimal domain module.
- [`deploy-coolify.md`](deploy-coolify.md) — the registry-based deployment
  guide if AWPOS chooses an online/multi-outlet topology.
- [`AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`](AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md)
  — the record of where the extraction of 18 generic issues out of the 38 AWPOS
  issues into this base came from.
- The [`ahliweb/awpos`](https://github.com/ahliweb/awpos) repo — docs 01-19,
  38 GitHub issues, milestones M0-M8 (state as of 2026-07-06; review the
  live state before executing since it can change).
