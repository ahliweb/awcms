---
"awcms": patch
---

Stop `Accepted` admission ADRs from reading as shipped modules.

Five ADRs — 0016 `organization_structure`, 0017 `document_infrastructure`, 0018
`data_exchange`, 0019 `integration_hub`, 0021 `reference_data` — are `Accepted`
for modules with no code in this repository. `Accepted` is a decision status, not
a delivery status, but nothing said so, and the roadmap already named the
consequence: someone reading `docs/adr/` "will conclude `organization_structure`
can be called. It cannot."

Not hypothetical. ADR-0020 asserted `reference_data` is `status: "active"` in the
registry, citing a merged PR number — true of `awcms-mini`, where the sentence
came from, and false here. Corrected.

Each of the five now carries an unmissable not-implemented block naming what is
absent and pointing at Wave A of the absorption roadmap.

`tests/adr-admission-implementation-status.test.ts` binds the two facts, which
otherwise live in different places and move independently: an admitted module
must be in `listModules()` **or** its ADR must carry the marker. It fails in both
directions — landing a module while the marker remains is caught too — and it
asserts separately that no ADR claims an absent module is active in the registry,
since prose copied between family repos is the likely source of the next
instance. No database, so it runs on every PR.
