🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0097-english-is-the-source-language.id.md)

# ADR-0097 — English is the source language; Indonesian is the mirror

- **Status:** Accepted
- **Date:** 2026-08-15
- **Decision maker:** @ahliweb
- **Related:** [ADR-0023](0023-bilingual-docs-indonesian-source-english-default.md) (superseded in part — decisions 1 and 2), `scripts/check-docs-translation.mjs`, `scripts/lib/docs-i18n-checks.mjs`, `scripts/docs-i18n-stamp.mjs`

## Context

ADR-0023 decided that Indonesian at `<name>.id.md` is the authoritative source and English at the bare `<name>.md` is a generated default, and it adopted that pattern for exactly three front-door documents. It then wrote the rest off explicitly: migrating the content documents was "a separate backlog, not scheduled by this ADR".

That backlog was never scheduled, and the result is the state this ADR is written in. Of 260 documents in scope, **four** follow the convention. The other **253 are Indonesian prose sitting at a bare path that the convention promises is English** — including every ADR, `PROJECT_STATE.md`, all 55 skills, and every module README. A reader who follows the repo's own rule and opens `<name>.md` expecting English gets Indonesian 97% of the time.

Two things changed since ADR-0023:

**The audience moved.** Skills are read by coding agents, not only by people. `.claude/skills/**` is 13,000 lines of operational instruction, and a skill that is misread produces wrong work rather than confusion — this repo has already recorded skills whose stale claims sent an agent in the wrong direction, most recently one that told readers a database role did not exist when it did.

**The direction was the expensive half.** ADR-0023 kept Indonesian authoritative so the original authors would not have to switch language. But the marker lives on the generated side, so every edit to an authoritative Indonesian file makes the English stale, and the English is what most readers and all agents see. Keeping the source in the language fewer readers use means the copy people actually read is the copy that is allowed to drift.

## Decision

1. **English at the bare path `<name>.md` is the authoritative source.** It is written and edited by hand, and it is what a reader or agent gets by default. Indonesian at `<name>.id.md` is the mirror.

2. **The staleness marker moves to the mirror.** `<!-- i18n-source-hash: sha256:<hex> -->` lives in `<name>.id.md` and records the hash of `<name>.md`. ADR-0023's mechanism is otherwise unchanged: the gate DETECTS drift, it does not translate, and no translation API is called from CI.

3. **Scope is the whole corpus, not a front door.** Every tracked document under `docs/**`, `.claude/skills/**`, `src/**/README.md`, `scripts/README.md`, and the root `README.md` is mirrored. Documents whose language is decided by a generator or an upstream spec — `api-reference.md` (from OpenAPI `description` fields), `repo-inventory.md`, `agent-memory.md` — are exempt from hand-mirroring; making those English is a change to the generator or the spec, which is where ADR-0023 already pointed for `api-reference.md`.

4. **The migration is a shrink-only ledger, not an intention.** `DOCS_AWAITING_MIRROR` in `scripts/check-docs-translation.mjs` names all 253 outstanding documents. Entries are removed as documents are translated; the gate rejects an entry whose mirror already exists, so the ledger cannot overstate the debt, and nothing may be added to it — a document written after this ADR is written in English and mirrored in the same change. This is the instrument ADR-0094 used to take the subject-data ledger from 139 to 0.

5. **Coverage and currency are separate checks.** "Is this mirror current?" and "which documents have no mirror at all?" are different questions. A document with no mirror has no pair to be stale, so fusing them would produce a gate that reads green while most of the corpus is untranslated.

6. **ADR-0023 decisions 3, 4, 5 and 6 stand.** The reciprocal language banner, the staleness gate rather than machine translation, the wiring into `bun run check`, and — importantly — **human review of the English for binding documents** (ADRs, and the parts of `docs/awcms/**` that state binding policy). The gate proves a translation is not stale; it cannot prove it is faithful, and on a governance document the difference between "must" and "may" moves a binding decision.

## Consequences

- **Positive:** the file every reader and every agent opens by default is the authoritative one, so the copy that drifts is the copy fewer people read — the inverse of the previous arrangement. The migration is measurable rather than aspirational, and cannot silently stall.

- **Trade-off, and it is the real one:** every documentation change now costs two writes, because the mirror must be re-translated in the same change or CI fails. Across 260 documents that is a permanent tax, accepted deliberately here. ADR-0023 flagged this same cost for three documents; this ADR takes it for all of them.

- **Trade-off:** the original authors write in Indonesian. Making English authoritative asks them to author in their second language or to translate their own drafts forward. That is the cost of having the default copy be the authoritative one, and it is why decision 6's human-review requirement is kept rather than relaxed.

- **Neutral:** 253 documents remain Indonesian at their bare path until their ledger entry is cleared. During the migration the convention is true of a growing subset rather than of everything, which is exactly the state ADR-0023 left behind — the difference is that it is now counted, and the count may only go down.
