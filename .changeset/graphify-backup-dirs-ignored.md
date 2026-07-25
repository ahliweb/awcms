---
"awcms": patch
---

Stop tracking graphify's dated backup directories.

Every `graphify` rebuild writes a full copy of the curated graph to
`graphify-out/<YYYY-MM-DD>/` — roughly 12 MB of duplicate JSON per run. The
previous refresh happened not to commit one; `.gitignore` now makes that a rule
rather than something whoever stages the change has to notice.

The live artifacts beside it (`graph.json`, `graph.html`, `GRAPH_REPORT.md`,
`manifest.json`) stay tracked — those are the reviewable output.
