🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](definition-of-ready.id.md)

# Definition of Ready (step 9 of the development flow)

> **Answered BEFORE anyone writes code**, and that is the whole point of it.
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) holds the Definition of **Done**,
> which is checked at the end. This list is checked at the start.

- **Flow step:** 9 ([`../alur-pengembangan.md`](../alur-pengembangan.md)).
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

## Two things that are NOT part of this list

- **Estimates.** They are not in this flow and they are not added here.
- **A complete design.** Step 9 asks whether the plan can be carried out and
  whether its specifications agree with each other — it does not demand final
  answers to the questions that are cheapest to answer precisely by writing code.
