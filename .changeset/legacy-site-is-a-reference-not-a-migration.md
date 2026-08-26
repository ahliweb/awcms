---
"awcms": patch
---

docs(adr): the legacy site is a feature reference, and the 301 obligation is withdrawn with the migration (#599, #711)

The product owner withdrew PRD §41's migration requirement on 26 August 2026:
not all articles from `seputarborneo.com` need to be migrated or imported, and
the site is to be used as a reference for its **features and functionality**.

Both open cutover issues stood on that one premise — #599 opens with it — so
withdrawing it decides both. Recorded as **ADR-0116**, which AMENDS ADR-0113,
ADR-0114 and ADR-0115 rather than superseding them: their mechanics were right
and are still right, and the only thing withdrawn is the clause each inherits
from PRD §41 / FR-DSC-007 — that _every_ legacy URL must resolve in one hop.

**The import is the small half; the 301 obligation is the load-bearing one.** A
301 is a promise that the content moved, so it cannot be issued for content that
did not. This repo already refused exactly that trade once, in ADR-0113, for
legacy search URLs: _"mengarahkannya ke artikel mana pun adalah 301 yang
berbohong."_ Applied consistently it gives the rule — **you cannot carry the
URLs without carrying the content** — and for an article deliberately left
behind the honest status is 410, never a 301 to a category index. 25,029 of
those is a soft-404 farm built with tooling written to make lying redirects hard.

**Zero behaviour change, and no job is deleted.** A selective import is the same
pipeline with a smaller input, and it needs no new code because
`listLegacyRedirectMappings` selects `WHERE legacy_source_id IS NOT NULL` — it
derives the map from rows that exist, so a partial import cannot produce a
dangling rule by construction. None of the six legacy jobs is in the `check`
chain, and the suites covering them test behaviour that has not changed.

One docblock is scoped in place rather than deleted:
`blog:legacy:cutover:verify` exists because an un-imported legacy URL "answers
404 on cutover day, and the ranking does not come back". That 404 is now the
INTENDED state, so a full-corpus run reports the desired outcome as failing —
a property of the corpus it is handed, not a defect in the job. No
`CutoverVerdict` member for "deliberately gone" was added, because no obligation
now requires the run that would need one.

Also recorded: the requirement was carried for weeks on two different counts of
its own subject — 23,906 in #599/#597 and several documents, against the legacy
database's 25,029 — which nobody reconciled.
