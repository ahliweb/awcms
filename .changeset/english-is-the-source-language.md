---
"awcms": minor
---

feat(docs): English becomes the source language, Indonesian the mirror (ADR-0097)

ADR-0023 already decided that `<name>.md` is what readers get by default and
`<name>.id.md` holds the other language. It adopted that for **three** front-door
documents and wrote the rest off as "a separate backlog, not scheduled by this
ADR". The backlog was never scheduled.

The state that left behind: of **260** documents in scope, **four** follow the
convention. The other **253 are Indonesian prose sitting at a bare path the
convention promises is English** — every ADR, `PROJECT_STATE.md`, all 55 skills,
every module README. A reader who follows the repo's own rule gets the wrong
language 97% of the time.

**What this change actually does is invert the direction**, which is the half
that was costing something. ADR-0023 kept Indonesian authoritative so the authors
would not have to switch language — but the staleness marker therefore lived on
the generated English side, so every edit to an authoritative Indonesian file
made the English stale, and the English is what most readers and **all coding
agents** see. Keeping the source in the language fewer readers use means the copy
people actually read is the copy allowed to drift. That is not hypothetical here:
this repo has already recorded skills whose stale claims sent an agent the wrong
way, most recently one asserting a database role did not exist when it did.

Mechanically:

- the `<!-- i18n-source-hash -->` marker moves to the `.id.md` mirror and records
  the hash of the English source;
- the language banner is rewritten on both sides, because ADR-0023's banner names
  Indonesian as "(sumber)" and a banner that lies about which file is
  authoritative sends the next editor to change the wrong one;
- `DOCS_AWAITING_MIRROR` names all **253** outstanding documents as a
  **shrink-only ledger** — entries come off as documents are translated, the gate
  rejects an entry whose mirror already exists, and nothing may be added;
- coverage and currency are **separate** checks, because a document with no
  mirror has no pair to be stale, so fusing them would produce a gate that reads
  green while most of the corpus is untranslated.

Generated artefacts (`api-reference.md` from the OpenAPI `description` fields,
`repo-inventory.md`, `agent-memory.md`) are exempt from hand-mirroring. Making
those English is a change to the generator or the spec — translating the artefact
would be overwritten on the next run.

All three failure modes were proven before this shipped, by reintroducing them:
an edited English source reports a stale mirror; a deleted mirror for an
off-ledger document reports missing coverage; a ledger entry whose mirror exists
reports an overstated ledger.

This is the first of several changes — the 253 translations follow, and each one
shrinks the ledger.
