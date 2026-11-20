🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](definition-of-ready.id.md)

# Definition of Ready (step 9 of the development flow)

> **Answered BEFORE anyone writes code**, and that is the whole point of it.
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) holds the Definition of **Done**,
> which is checked at the end. This list is checked at the start.

- **Flow step:** 9 ([`../alur-pengembangan.md`](../alur-pengembangan.md)).
- **Flow version:** v2.0.0. The v2 gate-9 checks are in §Gate 9 checks added by
  flow v2 below; their source is
  [ADR-0156](../../adr/0156-adopt-development-flow-v2-validated-ux-before-data-model-frontend-backend-integration-per-slice.md) §4.
- **For a NEW module**, this list does not replace
  [`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
  — it comes before it.

## Why this list exists, with evidence from this very repo

**Two consecutive waves wrote plans that assumed cross-tenant reads which FORCE
RLS forbids.** ADR-0087 asked for it as "an audit row in every reachable
tenant"; ADR-0088 asked for it as a membership list in a 409 response. Both were
plausible on paper, both got through planning, and both were only caught **at
implementation time** — after code had been written on top of a false premise.

One question would have found both at step 9, and it is the first one below.

## Questions that apply to EVERY change

1. **Does policy permit every read and every write this plan needs?** Not "is
   there a permission for it" — does **RLS** allow it. A plan that reads across
   tenants, or writes into another tenant, is almost always wrong, and the ones
   that are not wrong demand an ADR.
   **How to verify**: run the query as `awcms_app` in the relevant tenant context
   against a database holding similar data. Zero rows is an answer, not a setup
   failure.
2. **Which change class is it?** (the table in the flow document). It determines
   which of steps 1–8 are mandatory, and guessing it halfway through is how one
   PR becomes two PRs.
3. **What are its acceptance criteria, in a sentence that can fail?** "Works
   well" cannot fail. "Revoking a grant kills a live session in the same
   transaction" can.
4. **What will PROVE it, and which mutation turns it red?** A check that is green
   proves nothing until it has been proven to fail on the condition it is
   supposed to catch. If the answer has not occurred to you at step 9, that
   usually means the criteria in number 3 are not sharp enough.

## Conditional questions

| If the change touches…      | What must already be answered                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| the schema                  | its table/columns, its RLS, its FK indexes, **and its retention answer** (the gate will demand it) |
| access (RBAC/ABAC/RLS)      | which permission, deny-only or not, and where it sits in the chokepoint chain                      |
| an API/event contract       | its OpenAPI/AsyncAPI fragment, and whether the change is additive                                  |
| personal data               | the three questions in [`../privacy-analysis.md`](../privacy-analysis.md) §3                       |
| something landing **inert** | what makes it inert, and which PR turns it on                                                      |
| a foundation layer          | **its ADR**, not the intention to write one                                                        |

## Gate 9 checks added by flow v2 (ADR-0156 §4)

Flow v2 adds five checks to this gate and one more blocking defect. A box
answered "yes" with nothing a reviewer can open is **not** an answer: each row
names the evidence, and says honestly where the evidence **does not exist yet**.
Where the tooling for a check is missing, the check is answered "not ready" (or
"not applicable" with a reason), never ticked.

| #   | Check                                                                                                         | Evidence a reviewer can open                                                                                                                                                                                                                                                                                                                                                                                    | N/A only when                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| V1  | Every screen has a data source **mapped to a contract operation** (OpenAPI `operationId` or AsyncAPI channel) | The per-screen data inventory of step 4 (**no template exists yet**, see [`../alur-pengembangan.md`](../alur-pengembangan.md) §4, so link the inventory the issue carries) with each row pointing at a fragment in [`../../../openapi/modules/`](../../../openapi/modules/) or [`../../../asyncapi/`](../../../asyncapi/). `bun run api:spec:check` proves the fragment is valid, not that the screen is mapped | the change adds or alters **no screen** (backend-only, docs-only, chore)                                |
| V2  | High-severity usability findings (`UXT-*`) are **closed, or accepted by a named person**                      | The usability-test report of step 4. **No report template, ID scheme or recorded test round exists yet** (flow §4 gap): until one does, write "no test round held" and the **named person** who accepts shipping an untested screen                                                                                                                                                                             | no user-visible screen or flow changes                                                                  |
| V3  | The design is checked against **WCAG 2.2 AA**                                                                 | A design review against 2.2 AA, recorded in the issue or PR. `bun run design:token-contrast:check` and `tests/e2e/a11y-axe.e2e.ts` act **later and on built output**; they do not replace the design check. [`../14_ui_ux_design_system.md`](../14_ui_ux_design_system.md) still states 2.1 AA (flow §4 gap): review against 2.2 AA anyway                                                                      | no user-visible UI changes                                                                              |
| V4  | The mock is **generated from the contract** and **runs the contract's examples**                              | The generator run and its output. **No generator is installed** ([`../alur-pengembangan.md`](../alur-pengembangan.md) §8 gap), so for a slice that has an 11.1 this check currently cannot be satisfied: answer "not ready for 11.1 against a mock" or record, on the issue, the alternative used (see §11.1 for the SSR admin case). A hand-written mock is a second specification and never counts            | the slice has **no 11.1** (no screen or client consumes the contract)                                   |
| V5  | A **second** security and privacy pass over step 3, now that UI, data and API have a shape                    | The three questions of [`../privacy-analysis.md`](../privacy-analysis.md) §3 re-answered against the final screens, tables and operations; the permission of every operation and the RLS answer of question 1 above; masking on every screen that shows classified data. Record it in the issue or PR                                                                                                           | **never N/A as a whole**: a change with no data, endpoint or access effect writes that sentence instead |

### Blocking defects

A defect below sends the work **back to the step that holds it and then through
this gate again**. It cannot be waved through with a note.

| Defect                                                | Where to look                                                                                                                                                           | Automated check that exists                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| a screen with **no data source in the contract** (v2) | V1 above                                                                                                                                                                | none (`admin:screen-coverage:check` maps permissions to screens, which is a different question)                                           |
| an endpoint with **no permission**                    | the `permissions` descriptor in `src/modules/*/module.ts` and the operation's security fragment                                                                         | `access:permissions:enforcement:check`, `access:chokepoint:check`, `api:spec:check`                                                       |
| a table with **no classification**                    | the sensitivity level in [`../04_erd_data_dictionary.md`](../04_erd_data_dictionary.md) §Sensitive data classification, plus the RLS answer and the data-subject answer | RLS: `security:readiness`; data subject: `subject-data:coverage:check`. **No gate that checks the classification level itself was found** |
| a PII column with **no retention policy**             | the table's `dataLifecycle` descriptor ([`../data-lifecycle.md`](../data-lifecycle.md))                                                                                 | `data-lifecycle:table-coverage:check`                                                                                                     |

### A change that has no screen

Backend-only, docs-only, chore and dependency changes do **not** need a UI
prototype, a usability test, a WCAG review or a mock. V1–V4 are then written
"N/A" **with the reason** (for example "no screen: adds `GET /api/v1/...` only"),
and the reviewer can disagree with the reason. What never becomes N/A: the
permission of every operation, the RLS answer, the privacy answer and V5. The
change-class table in [`../alur-pengembangan.md`](../alur-pengembangan.md)
decides which of steps 1–8 are mandatory; this section only says how the new
checks apply once that is decided.

### Frontend and persona-app consumers

For a slice whose screens live in a consumer repo (`awcms-astro`, a persona
app), V1–V4 are answered there against **this repo's contract**, and the issue
here only links that evidence. This repo does not own the consumer's usability
test, but it owns the contract operation that V1 maps to.

## New product surface (a screen or an app)

Applies when the change adds a **new screen, app or client** rather than changing
an existing one. Source: [ADR-0146](../../adr/0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.md) §6; the classifier is
`classifySurface` in [`scripts/lib/product-surface-policy.ts`](../../../scripts/lib/product-surface-policy.ts).

This section **binds once ADR-0146 is Accepted**; while it is Proposed, use it
as guidance. The structural no-Lynx check in `tests/product-surface-policy.test.ts`
runs already, whatever the ADR status.

1. **What does it manage, and for whom?** The system, or a person's own part of
   a site, makes it an **admin** surface: stop, it is Astro (`system-admin` here,
   `user-admin` in `awcms-astro` only when the site declares it, or `pwa-admin`).
2. **Is it public and meant to be crawled?** Then `public-web`: Astro.
3. **Is it a persona workflow** (transactional, interaction-intensive,
   native-capability-bound)? Then `persona-app-native` or `persona-app-web`.
   Record the kind the classifier returns; if it throws, the surface is
   unclassified and **not ready**. "App" is not a `/app` URL, a phone-sized
   layout or an installable manifest.
4. **Which repo?** A persona app is a consumer repo with its own issues; this
   repo gets no UI feature for it, and no `@lynx-js/*` dependency, import or
   `lynx.config.*` (a test fails if one appears).
5. **Which public contracts does it call**, with per-resource authorization for
   this actor? A missing endpoint is an ordinary API issue here.
6. **Auth and session** for this client type (PKCE, secure storage on native,
   CSRF/CORS on Web); **offline, cache and sync policy** (conflict, replay,
   idempotency, tenant context, remote revoke, data minimisation); **push**
   adapter per platform.
7. **PoC result linked** (Android, iOS, HarmonyOS, Web, and Bun tooling, run
   outside this repo), or the PoC is the first task.
8. **Threat model, MASVS/ASVS, and a DPIA** when sensitive data is processed.

## Two things that are NOT part of this list

- **Estimates.** They are not in this flow and they are not added here.
- **A complete design.** Step 9 asks whether the plan can be carried out and
  whether its specifications agree with each other — it does not demand final
  answers to the questions that are cheapest to answer precisely by writing code.
