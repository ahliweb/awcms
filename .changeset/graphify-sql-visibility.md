---
"awcms": patch
---

Make the migration layer visible to the knowledge graph, and stop tracking
`graph.html`.

`tree_sitter_sql` was missing, so all 70 files in `sql/` contributed **nothing**
to the graph — the layer that holds every RLS policy, every grant, and every
tenant-isolation predicate was simply absent. Three defects fixed this week lived
there, and the graph could not have helped find any of them. With the grammar
installed the graph gains 179 nodes and 153 edges, including the tables
themselves (`awcms_tenants`, `awcms_offices`, …) rather than just file names.

Note for anyone rebuilding: graphify keys its cache on `manifest.json`, not on
`cache/stat-index.json`. Installing a new grammar does not invalidate anything,
so `--update` reports every file unchanged and the new grammar never runs. The
entries have to be dropped from `manifest.json` to force re-extraction.

`graph.html` is no longer tracked. It silently stops being emitted once the
corpus passes graphify's viz node limit — the committed copy then rots while
`graph.json` beside it stays current, which is precisely the failure mode this
repo keeps getting bitten by. It is also ~8.7 MB per rebuild on top of
`graph.json`'s ~10 MB, doubling what each refresh adds to history permanently.
Regenerating is one command, documented in `.gitignore` next to the rule.
