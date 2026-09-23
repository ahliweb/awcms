🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `knowledge/generated/` — machine-written, disposable

Nothing under this directory except this file is tracked in Git (see
`.gitignore`: `knowledge/generated/*` with `!knowledge/generated/README.md`).
This README is kept tracked only so the directory does not read as
empty/missing in a fresh checkout — the actual content is rebuilt on demand.

`graphify/` is populated by `bun run knowledge:obsidian:export`
(`scripts/knowledge-obsidian-sync.ts`), which copies an allow-listed subset of
Graphify's Obsidian export from `graphify-out/obsidian-staging/`. See
`../README.md` and `docs/awcms/knowledge-graph.md` for the full pipeline,
fail-closed guarantees, and the "map, not the territory" rule that governs
everything Graphify writes here.

Nothing here is ever hand-edited. If it looks wrong, delete it and re-run the
export — it is rebuilt from `graphify-out/` and `knowledge/curated/` (read
only, for collision detection), never merged incrementally.
