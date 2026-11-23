---
"awcms": patch
---

chore(data): neutralise the legacy import example. The example redirect map directory is now `data/legacy-news-example/`, its provenance block and README no longer carry local paths or source-system details, the third-party Wayback URL list is removed (nothing read it), and code comments, CLI help examples and test fixtures use generic names (`--system=legacy-cms`). No behaviour change; stored `legacy_source_system` values and applied migrations are untouched.
