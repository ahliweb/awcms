🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](decisions-index.id.md)

# Decisions index

The full, authoritative list of decisions is
[`../../docs/adr/README.md`](../../docs/adr/README.md) — this note only orients
a reader toward the ADRs a knowledge-graph/Obsidian session is most likely to
need, and is not a substitute for reading the ADR itself.

- **ADR-0124** — Obsidian opens a dedicated `knowledge/` vault, not the
  repository root (this vault's own admission decision).
- **ADR-0062** — skills are gated against the code they describe; a skill
  describing something false is more dangerous than a stale doc.
- **ADR-0097** — English is the translation source, `*.id.md` is a hash-mirror
  — why `.graphifyignore` excludes `*.id.md` from the knowledge graph.
- **ADR-0034 / ADR-0035 / ADR-0055 / ADR-0070** — where a module or screen is
  built (`awcms` vs `awcms-astro`), read before starting any new capability.

Do not copy an ADR's content into this file when it changes — update the one
line above, or add a new line, and follow the link.
