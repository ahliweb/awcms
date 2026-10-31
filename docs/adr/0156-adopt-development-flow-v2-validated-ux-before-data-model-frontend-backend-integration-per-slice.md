🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0156-adopt-development-flow-v2-validated-ux-before-data-model-frontend-backend-integration-per-slice.id.md)

# ADR-0156 — Adopt development flow v2: validated UX/UI before the data model, and frontend → backend → integration per slice

- **Status:** Accepted
- **Date:** 2026-10-30
- **Decision maker:** ahliweb (owner), decided 2026-10-30
- **Amends:** the step order of [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.md) (the canonical flow written on 13 August 2026). It does not amend any earlier ADR.
- **Related:** [ADR-0083](0083-this-template-deploys-to-one-environment.md) (steps 13–14 stay NOT APPLICABLE), [ADR-0146](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.md) (the new-surface questions keep their gate), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md). Upstream decision: **DL-033** in the `ahliweb/personal-coding` decision log, whose `docs/alur-pengembangan-produk.md` v2.0.0 is the generic flow this repo adopts.

**Docs and governance only.** This ADR adds no module, migration, route, OpenAPI path, AsyncAPI channel, dependency or tooling. It changes the _order_ in which existing documents are produced and names the gaps that the new order exposes.

## Context

The canonical flow (v1) put UX/UI at **step 8**: after the ERD (4), the RBAC/ABAC/RLS matrix (5), the domain specification (6) and the API contract (7). Only then did a screen get drawn, and the cross-spec review (9) was the first place all of them met.

That order has a structural cost, and it is the cost this repo has already paid more than once in a different form (ADR-0087 and ADR-0088 wrote plans that assumed reads FORCE RLS forbids, and were caught during implementation, not at step 9):

- **The contract is frozen before anyone has seen the screen.** The data model and the API are shaped by what the author _thinks_ a screen needs. When the screen is drawn at step 8, the gap is a change to a contract that has already been reviewed, so it is either absorbed as an awkward endpoint or it re-opens steps 4–7.
- **Nothing in v1 tested the design with a user before code existed.** Step 8 answered "its shape on screen"; it did not require a prototype that a representative user had tried. The first contact between a user and the product was a built screen.
- **Step 11 was one undivided block.** "Implementation" let a frontend and a backend be built against each other's guesses and joined at the end. That is big-bang integration, and the integration cost lands in the last week.

The generic flow in `ahliweb/personal-coding` was revised to v2.0.0 on 2026-10-30 (DL-033) to fix this. Its normative authority for `awcms` stays here: that document says explicitly that its v2.0.0 does not automatically apply to a product repo and needs an ADR in that repo. This is that ADR.

## Decision

Adopt flow **v2.0.0** in `docs/awcms/alur-pengembangan.md` (English source and Indonesian mirror).

### 1. UX/UI moves from step 8 to step 4, as a validated prototype

Step 4 becomes **UX/UI visualisation + validated prototype**: information architecture, user flows, a prototype that representative users have tried, every screen state (empty, loading, error, partial, no permission, offline/slow, destructive confirmation), WCAG 2.2 AA from design time, and a **per-screen data inventory** (what each screen displays, inputs, filters, sorts). The inventory is the direct input to the ERD (5) and the contract (8). Step 2 gains user research as a required input to the PRD.

### 2. Numbering map

| v1 (13 Aug 2026)                          | v2 (this ADR)                                            | Change                                                     |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 1 Master Blueprint                        | 1 Master Blueprint                                       | none                                                       |
| 2 PRD                                     | 2 User Research + PRD                                    | research becomes a required input                          |
| 3 Threat Model + Privacy                  | 3 Threat Model + Privacy                                 | none (a second pass is added at gate 9)                    |
| 8 UX/UI                                   | **4** UX/UI Visualisation + Validated Prototype          | moved to the front of the data model                       |
| 4 ERD + Data Dictionary                   | **5** ERD + Data Dictionary                              | +1                                                         |
| 5 RBAC + ABAC + RLS Matrix                | **6** RBAC + ABAC + RLS Matrix                           | +1                                                         |
| 6 Domain / Verification Algorithm         | **7** Domain / Verification Algorithm                    | +1                                                         |
| 7 OpenAPI + AsyncAPI                      | **8** OpenAPI + AsyncAPI + mock generated from it        | +1; the mock is generated, never hand-written              |
| 9 Cross-Spec Review / Definition of Ready | 9 (unchanged number)                                     | gains the new checks in §4                                 |
| 10 Atomic GitHub Issue                    | 10                                                       | issues are cut per vertical slice, each 11.1 → 11.2 → 11.3 |
| 11 Implementation + Automated Tests       | 11 = **11.1 Frontend → 11.2 Backend → 11.3 Integration** | split, mandatory order, per slice                          |
| 12 PR + Review + CI                       | 12                                                       | every PR of 11.1, 11.2 and 11.3 goes through it            |
| 13–14 (N/A, ADR-0083), 15–18              | 13–14 (N/A), 15–18                                       | none                                                       |

### 3. Step 11 is split per vertical slice

- **11.1 Frontend** is built against a **mock generated from the contract**, covering all states including error and no-permission.
- **11.2 Backend** implements the same contract; a difference sends the work back to step 8, never a silent adjustment.
- **11.3 Integration** swaps the mock for the real backend, runs the contract test on both sides and the end-to-end test of the critical path.

Per slice, not per product: finishing all frontend before any backend is big-bang integration and is not allowed. A contract gap found by the frontend goes back to step 8 and through gate 9 again (an additive, backward-compatible change may use a short recorded contract review). **Authorisation stays enforced in the backend and the database** (the chokepoint, FORCE RLS); the frontend only mirrors it. Nothing in this ADR moves a check to the client.

### 4. Gate 9 gains checks, including one blocking defect

Added to the cross-spec review (the Definition of Ready): every screen has a data source mapped to a contract operation; high-severity usability findings are closed or consciously accepted by a named person; the design is checked against WCAG 2.2 AA; the mock is generated from the contract and runs its examples; and a **second** security/privacy pass over step 3 happens now that UI, data and API have a shape.

**New blocking defect: a screen with no data source in the contract.** It joins the existing ones (an endpoint with no permission, a table with no classification, a PII column with no retention policy). It cannot be waved through with a note.

### 5. Why gates 9 and 15 keep their numbers

Numbers are references, and these two are the most-cited in this repo. "Step 9" is cited by the Definition of Ready template and its mirror, `docs/awcms/README.md`, ADR-0146 §6 and the flow document itself; "step 15" and the steps 10, 12 and 13–18 are cited by `AGENTS.md`, `CONTRIBUTING.md`, the agent prompts, the release register and the production runbooks. Renumbering them would make every one of those a silent lie that no gate would notice, and the cost buys nothing: the revision only reorders work inside the specification phase and splits step 11. The map above is the translation table. The rule that follows: a reference to "step 4" through "step 8" written **before 2026-10-30** uses the v1 numbering.

Steps 13 and 14 remain **NOT APPLICABLE** under ADR-0083. v2 does not turn staging on. The v2 text of gate 15 that asks for usability findings "on a real build" is satisfied here only by step 17 (production validation), with the cost that `alur-pengembangan.md` §14 already records.

## Consequences

**References that were renumbered in this change** (live documents only):

- `docs/awcms/alur-pengembangan.md` and `.id.md`: the diagram, the change-class table, every section 4–8, the step 2 and 11 text, the gap table, and the §8/9 sentence about new product surfaces (now a step 4 and 9 decision).
- `.claude/agents/awcms-security-auditor.md`: "step 5 (RBAC/ABAC/RLS matrix)" is now step 6.
- `CONTRIBUTING.md`: the list of steps 1–9 that this document does not cover is reordered, and step 11 is noted as split.
- `AGENTS.md`: the change-class sentence is updated for the split of step 11.

**References deliberately NOT changed:**

- Historical ADRs (0001–0155) keep their wording as records. Where one writes "step N" in the 4–8 range it means v1; ADR-0146 §6 says "step 9", which is unchanged.
- `docs/awcms/templates/definition-of-ready.md` and the references to steps 3, 9, 10–12 and 18 in other documents: the numbers did not move.
- `docs/PROJECT_STATE.md` historical round entries and `CHANGELOG.md`.
- Generated artefacts (`graphify-out/`): regenerated by their own tool, not edited by hand.

**New gaps, written down and not hidden** (details in the flow document): no usability-test or per-screen data-inventory artefact; WCAG 2.1 AA in `14_ui_ux_design_system.md` against the 2.2 AA of v2; no tooling that generates a mock or a client from the OpenAPI contract; the consumer-contract snapshot is one-sided; the Definition of Ready template does not yet carry the new gate-9 checks. Each needs its own issue; this ADR does not close them.

**Cost.** Step 4 becomes heavier and earlier: a change that touches a user-visible screen needs a tried prototype before its schema is drawn. The change-class table keeps this proportionate, since a bug fix or docs change still walks only 10 → 12.

## Alternatives considered

1. **Keep v1.** Rejected: it freezes the contract before the screen is seen, which is the cost described in Context.
2. **Adopt v2 and renumber everything to be tidy.** Rejected: gates 9 and 15 are the most-referenced numbers, and renumbering them silently stales documents the gates cannot detect (§5).
3. **Adopt the order but not the 11.x split.** Rejected: moving UX first without splitting step 11 leaves the big-bang integration, which is half of the problem.
4. **Turn staging on so usability can be tested on a build.** Out of scope: that is a decision to supersede ADR-0083, not to be taken inside a process ADR.

## References

- `ahliweb/personal-coding`: `docs/alur-pengembangan-produk.md` v2.0.0 (§Pernyataan Pokok, §3, §5 steps 4 and 11, §6) and decision log DL-033.
- [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.md)
- [ADR-0083](0083-this-template-deploys-to-one-environment.md), [ADR-0146](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.md)
