🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0023-bilingual-docs-indonesian-source-english-default.id.md)

# ADR-0023 — Bilingual documentation: Indonesian source, English as the default, staleness-gated

- **Status:** Accepted
- **Date:** 2026-07-16
- **Decision maker:** @ahliweb
- **Related:** `docs/adr/README.md` §Rules #4 (a change to a binding standard requires an ADR), ADR-0022 (context for the "front door" documents that were just realigned), `scripts/check-docs.mjs`/`scripts/lib/docs-checks.mjs` (the pure-logic + I/O docs-check pattern that is followed), `scripts/db-migrate.ts` (the checksum pattern that is adapted)

## Context

This repo's technical contributors and decision makers write in Indonesian — all of `docs/awcms/**`, `docs/adr/**`, and `README.md` are currently pure Indonesian. But this repo needs to present itself with **English as the default** for external readers (international contributors, ERP extension/derived application integrators who read `README.md`/the docs index first), without forcing the original authors to switch language or losing the authority of the existing Indonesian content.

There is no built-in bilingual rendering mechanism for static Markdown files on GitHub — the file literally named `README.md` is the one shown as the repo's front page. There is no translation API key/provider installed in this repo (this repo is Bun-only, offline-first, with no AI provider integration for docs tooling); calling a translation service straight from CI means adding a new secret, cost, and network dependency for something that is not part of the production path.

Scope: `docs/awcms/**` alone contains ~30,000 lines across ~40 files (including `api-reference.md` at 17,829 lines — a generated artifact from OpenAPI, not hand-translated prose). Translating all of it at once is not a single change's worth of work; this policy therefore has to support a **gradual per-file rollout**, rather than requiring everything to be finished before the mechanism takes effect.

Note: this is **different** from the application's UI i18n system (`.po`/gettext catalogues, the `awcms-i18n` skill, doc 04) which translates **content seen by the application's end users** (tenants, products, etc.). This ADR only governs the **repo's technical/governance documentation** — its audience is contributors and integrators, not the end users of a derived application.

## Decision

We decide:

1. **Path convention:** for every document that follows this policy, `<name>.id.md` is the **authoritative Indonesian source** (written/edited by a human), and `<name>.md` (the bare path, with no language suffix) is the **generated English** — this is what shows as the default (e.g. the root `README.md` that GitHub renders, or the bare links other documents use). No existing file is renamed beyond the three "front door" documents in decision #2 — documents that have not adopted this pattern stay Indonesian at their bare path until their migration turn comes.

2. **Initial adoption (this change):** three front-door documents adopt the pattern above now — `README.md` (root), `docs/awcms/README.md` (docs package index + descriptions), `docs/adr/README.md` (ADR index). Body documents (`docs/awcms/01_canvas_induk.md` onwards, all of `docs/adr/000X-*.md`) **stay Indonesian at their bare path** for now — subsequent migration happens per file/batch as needed, following the same pattern.

3. **Language-switcher banner:** every file that follows this pattern (both the `.id.md` and its `.md` counterpart) carries a reciprocal link line right at the top (e.g. `🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia](README.id.md)` in the English version, the reverse in the Indonesian one) so a reader who lands on the "wrong" language immediately knows a counterpart exists.

4. **Automatic staleness gate, not automatic translation:** `scripts/check-docs-translation.mjs` (pure logic in `scripts/lib/docs-i18n-checks.mjs`, the same pattern as `check-docs.mjs`/`docs-checks.mjs`) validates that every git-tracked `*.id.md` has a `*.md` counterpart carrying an `<!-- i18n-source-hash: sha256:<hex> -->` marker matching the SHA-256 hash of the current ID source content. This gate **detects drift**, it does not translate — if the ID source changes without EN being regenerated, CI fails with a message pointing at which file is stale. Regenerating EN (by a human or an AI agent such as Claude Code) and updating the hash marker happens as part of the same change that alters the ID source — not as a separate API call in CI.

5. **Wiring:** `check:docs:translation` enters `bun run check` right after `check:docs` (in parallel with mermaid/links/naming), and as a separate CI step in the `.github/workflows/ci.yml` `quality` job, following that file's own rule that step order mirrors `check` in `package.json`.

6. **Human review for binding documents:** for `docs/adr/**` and the parts of `docs/awcms/**` that state binding policy (RBAC/ABAC, threat model, contracts), the generated English translation **must be reviewed by a human before merge** — the staleness gate ensures EN is not stale, but does not validate accuracy of meaning; imprecision in a governance document (e.g. "must" vs "may") risks shifting a binding decision unnoticed.

## Consequences

- **Positive:** the root `README.md` and the two main indexes immediately present in English to external readers without changing a single path already referenced by skills/other documents (only the content switches language); the Indonesian source stays authoritative and is not lost; drift between ID and EN is detected automatically in CI, instead of surfacing only when a reader complains the contents differ.
- **Trade-off:** every change to a document that has adopted this pattern adds one step (regenerate EN + update the hash marker) before CI goes green; migrating the ~40 body documents of `docs/awcms/**` to this pattern is a separate backlog item that this ADR does not schedule.
- **Neutral:** `api-reference.md` (a generated artifact from OpenAPI) is deliberately **out of scope** for this policy — if it needs to be bilingual, the route is to translate the descriptions in the source OpenAPI spec, not to translate an artifact that is regenerated every time.

## Alternatives considered

- **Translating all of `docs/awcms/**`/`docs/adr/**` at once in a single change** — rejected: ~30,000 lines with no gradual review path carries a high risk of mistranslating a binding document, and is unrealistic to verify in one round.
- **A direct translation API call in CI (live translation on every push)** — rejected: it adds a new secret/cost/network dependency to a repo that so far is deliberately offline-first-safe on its core path; it also produces translations with no review pause before they are published as the default, which is risky for binding documents (see decision #6).
- **A parallel directory (`docs/awcms/en/*.md`) instead of the `.id.md` suffix** — rejected for the "front door" documents: the root `README.md` specifically MUST live at that path for GitHub to render English as the default; a directory pattern does not achieve that for the root README. The `.id.md`/bare `.md` suffix was chosen so that one convention applies consistently to both the root README and to whichever `docs/**` document migrates next.
- **A `lang:` frontmatter with no separate file (one file, many language blocks)** — rejected: it makes every file twice as long and hard to diff per language; two separate files give a clean git history per language and make a hash-based staleness check straightforward.
