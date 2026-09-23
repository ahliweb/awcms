🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](architecture-index.id.md)

# Architecture index

Where the architecture actually lives, and how to ask the graph about it.

- **Canonical current-state description:** [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
- **Every binding architectural decision:** [`../../docs/adr/README.md`](../../docs/adr/README.md)
  (index of all ADRs — never copy an ADR's content here, link it).
- **The knowledge graph:** `graphify-out/graph.json` (~12700 nodes at last
  rebuild — see [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  for current counts) is the machine-derived structural map. Query it instead
  of re-reading the whole tree:
  ```bash
  graphify query "<question>"
  graphify path "<concept A>" "<concept B>"
  graphify explain "<node>"
  ```
  Read [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  **before** trusting a finding — the graph mixes "was once true" with "is true
  now", and low cohesion on a deliberate chokepoint (e.g. `withTenant` +
  `authorizeInTransaction`) is not a defect. Every claim from the graph is a
  hypothesis until checked against code/`sql/`/`bun run check`.
- **Module composition & dependency order:** `bun run modules:dag:check`,
  [`../../src/modules/module-management/README.md`](../../src/modules/module-management/README.md).
- **Obsidian generated view of the graph** (optional, rebuildable):
  `knowledge/generated/graphify/` after `bun run knowledge:obsidian:export` —
  see [`../README.md`](../README.md).
