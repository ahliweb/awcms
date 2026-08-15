🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](07-roadmap-gates-kepatuhan.id.md)

# 07 — Roadmap, quality gates, KPIs, and compliance

> Plan. See the [README](README.md) for status.

## 1. Phases and exit criteria

| Phase                          | Main output                                                                                                                                             | Exit criteria                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **P0 — Architecture baseline** | ADR-0045 + the rendering/BFF ADR in `awcms-astro`; inventory reconciliation; session contract; merchant/scope model; five descriptors + table ownership | Every critical gap has a decision, an owner, a test, and a rollback plan           |
| **P1 — Domain foundation**     | Migrations, descriptors, permission seeds, RLS, ABAC, services, API, minimum admin screens                                                              | The negative-authorization matrix passes; every module gate green                  |
| **P2 — Public experience**     | Design tokens, homepage, categories, search, business/product pages, content & legal                                                                    | Visual acceptance, WCAG 2.2 AA baseline, zero placeholders & broken critical links |
| **P3 — Seller portal**         | Auth/session, onboarding, profile, catalogue, promotion, leads, analytics, plans                                                                        | End-to-end merchant activation; zero cross-merchant leaks (proven by test)         |
| **P4 — Affiliate portal**      | Links, attribution, conversions, commission ledger, payout flow                                                                                         | Self-referral & fraud controls; maker-checker; reversible adjustments              |
| **P5 — Pilot & hardening**     | UAT, performance, security verification, DPIA, continuity, runbooks                                                                                     | GO criteria met for a limited pilot                                                |
| **P6 — Repeatability**         | Cohorts, renewals, support effort, channel repeatability                                                                                                | Scale only after retention, quality, security, and unit economics are stable       |

Every phase is broken down into atomic units of work: one bounded context (or one
slice of a surface) per PR, carrying migration + seed + OpenAPI fragment + tests +
docs + changeset.

## 2. Quality gates (blocking)

Repo gates that **already exist** and must be green:

- The full `bun run check` (lint, docs, API contract, module DAG, table & route
  ownership, job registry, composition, logging lint, tenant route factory, tenant
  context usage, typecheck, test, build).
- `bun run security:readiness`, `bun run family:conformance:check`.
- RLS isolation verified as the application role (`awcms_app`), not as a superuser.

Extra Jualanku-specific gates:

- 100% of endpoints covered by OpenAPI + a security scheme.
- 100% of tenant-scoped tables with `FORCE` RLS + a tenant isolation test.
- 100% of portal mutations pass through the BFF, CSRF, authorization, validation, audit, correlation ID.
- 0 bearer tokens in `localStorage`/`sessionStorage`.
- 0 private routes in the sitemap or in a public cache.
- 0 placeholders, internal notes, demo data, or demo PII in production.
- An OWASP ASVS 5.0 control profile is set; at least **L2** for the portal and
  admin, with documented tailoring.
- WCAG 2.2 AA: automated + manual verification on critical flows.
- Backup-restore drills, incident runbooks, and session revocation pass.
- The PMSE/PSE legal memo, privacy notice, terms, affiliate policy, and merchant
  agreement are approved.

## 3. KPIs

| Dimension   | Main KPI                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------ |
| North Star  | Monthly active merchants with a published page **and** at least one meaningful interaction |
| Acquisition | Qualified merchant sign-ups, approved affiliates, source/channel                           |
| Activation  | Onboarding completion, time to first published page, profile completeness                  |
| Engagement  | WhatsApp clicks, inquiries, verified leads, promotion usage                                |
| Revenue     | MRR, ARPA, paid conversion, margin, refunds                                                |
| Retention   | D30 active, churn, renewal, cohort engagement                                              |
| Affiliate   | Attributed conversions, approval rate, hold releases, payout SLA, fraud rate               |
| Operations  | Support minutes per merchant, verification SLA, moderation backlog, CSAT                   |
| Technology  | Availability, p95 latency, error rate, MTTR, deploy failure, cost per active merchant      |
| Risk        | Authorization-denial anomalies, PII incidents, fraud, complaints, audit completeness       |

## 4. RACI

| Activity                          | Product/Arch | Engineering | Growth | Operations | Finance/Risk |
| --------------------------------- | ------------ | ----------- | ------ | ---------- | ------------ |
| ADRs & target architecture        | A/R          | R           | C      | C          | C            |
| Domain model & API contracts      | A            | R           | C      | C          | C            |
| Design system & screen acceptance | A/R          | R           | C      | C          | I            |
| Auth, security, deployment        | C            | A/R         | I      | I          | C            |
| Merchant onboarding               | C            | R           | C      | A/R        | C            |
| Affiliate rules                   | C            | R           | A/R    | C          | A            |
| Pricing & subscriptions           | C            | C           | R      | C          | A            |
| Payout/refund/fraud               | I            | R           | C      | C          | A/R          |
| Privacy/legal/compliance          | C            | R           | C      | C          | A/R          |
| Product acceptance                | A            | C           | C      | C          | C            |
| Technical release approval        | C            | A           | I      | I          | C            |

## 5. GO / PIVOT / PAUSE / STOP criteria

**GO**

- P0 is closed and the repo inventory is consistent.
- The public, merchant, affiliate, and internal surfaces are separated by route,
  session audience, cache, and authorization.
- The negative-authorization matrix passes.
- A pilot merchant can complete the publish flow and receive meaningful interactions.
- Privacy/legal documents + a complaints channel are available.
- Observability, backup/restore, incident, and support runbooks are tested.

**PIVOT**

- Self-service onboarding fails but assisted onboarding succeeds → simplify the
  wizard, strengthen the assistance.
- There is search traffic but contact interactions are low → fix relevance, card
  content, and CTA before adding features.
- Affiliate clicks are high but approved conversions are low → fix attribution,
  the offer, and the fraud policy before raising commissions.

**PAUSE**

- The session/tenant context can still be manipulated by the browser.
- Cross-merchant authorization has not been proven by test.
- Private responses can still end up in a cache/sitemap.
- Commissions/payouts do not yet have a ledger, holds, refunds, tax, and maker-checker.
- The regulatory classification and terms have not been approved.
- A critical UAT or accessibility flow fails.

**STOP / NOT YET**

- Marketplace checkout, escrow, logistics, wallet, or multi-merchant transactions
  before PMF and operational readiness.
- Microservices, multi-region, native apps, or complex AI without a quantified
  need.
- Features without an owner, API contract, lifecycle, permissions, audit, KPIs, and
  exit criteria.

## 6. Standards

| Area                 | Baseline (as of 29 July 2026)                                                          |
| -------------------- | -------------------------------------------------------------------------------------- |
| Application security | ISO/IEC 27034-1:2011 + OWASP ASVS 5.0                                                  |
| API security         | OWASP API Security Top 10:2023 + an authorization test suite                           |
| ISMS                 | ISO/IEC 27001:2022 (Amd 1:2024), control guidance ISO/IEC 27002:2022                   |
| Risk                 | ISO/IEC 27005:2022                                                                     |
| Privacy              | ISO/IEC 27701:2025                                                                     |
| Cloud PII            | ISO/IEC 27018:2025                                                                     |
| Cloud security       | ISO/IEC 27017 — **transition watch** (the 2026 edition was in progress at validation)  |
| Security evaluation  | ISO/IEC 15408 Parts 1–5:2026, **only** for critical components (session/authorization) |
| Accessibility        | WCAG 2.2 AA / ISO/IEC 40500:2025                                                       |
| Product quality      | ISO/IEC 25010:2023; requirements & traceability ISO/IEC/IEEE 29148:2018                |
| AI                   | ISO/IEC 42001:2023 — only if AI becomes a material component for decisions/risk        |

**Limits on using Common Criteria.** ISO/IEC 15408 is not a UI checklist and not a
replacement for 27001/ASVS. It is used as a concept (Target of Evaluation, Security
Target, assurance evidence) on the session/authorization components. **There is no
EAL claim or "Common Criteria certified" claim**, and no ISO certification claim of
any kind in the product or in marketing documents.

## 7. Indonesian regulation

| Regulation                                   | Relevance                                                              | Action                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Law 27/2022 (PDP)                            | Subject rights, processing basis, controller/processor, breach         | ROPA, privacy notice, consent, DSR flow, retention, processor clauses, incident process               |
| Law 1/2024 (second amendment to the ITE Law) | Electronic information & transactions                                  | Legal terms review, evidence, prohibited content, electronic contracts                                |
| GR 71/2019 (PSTE)                            | Reliability & security of electronic systems                           | PSE assessment, security controls, auditability, continuity                                           |
| Permenkominfo 5/2020 jo. 10/2021             | Private-scope PSE                                                      | Validate registration & operating obligations before launch                                           |
| GR 80/2019 (PMSE)                            | Trade through electronic systems                                       | Business model mapping, merchant information, contracts, complaints, records                          |
| Permendag 19/2026                            | PPMSE business models, advertising, domestic products, AI, supervision | Legal classification based on production features; update terms, merchant agreement, affiliate policy |
| Law 8/1999 (Consumer Protection)             | Information, fairness, complaints, prohibited clauses                  | Clear pricing, evidence for claims, complaint/refund process, no dark patterns                        |

**The PMSE classification must not be assumed from branding.** Because the early
phase is not a full marketplace and transactions can be directed to merchant
channels, Finance/Risk/Compliance writes a legal memo based on the **real
production features**: transaction flow, advertising, affiliate, payments, and the
platform's role towards merchants/consumers.

## 8. Acceptance checklist

**Architecture** — ADRs approved · `awcms` origin private · SSR adapter installed ·
rollback to static documented · rendering matrix tested.

**Identity & access** — no tokens in browser storage · HttpOnly/Secure cookies ·
CSRF protection · server-derived tenant · session rotation/revocation · negative auth tests.

**Data** — RLS FORCE on tenant tables · merchant ownership ABAC · field masking ·
retention & legal hold · correlation ID in audit · idempotency on critical
mutations.

**UI/UX** — design tokens · every state (empty/error/loading) · keyboard flow ·
WCAG 2.2 AA · mobile 360 px · no placeholders · copy/claims approved.

**Operations** — monitoring · alerting · runbooks · backup restore · incident drills ·
support SLA · complaint flow.

**Commercial/affiliate** — plan entitlements · invoice as source of truth ·
commission ledger · holding period · refund/dispute · self-referral prohibition ·
payout maker-checker.

**Legal/privacy** — PSE assessment · PMSE classification · privacy notice · terms
versioning · merchant agreement · affiliate policy · data subject request flow.
