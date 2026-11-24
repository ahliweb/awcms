---
"awcms": patch
---

docs(adr): the ADR index listed ADR-0170 twice (the pre-amendment row survived a conflict resolution next to the current one) in both `docs/adr/README.md` and its Indonesian mirror; the stale rows are removed. New `tests/adr-index-integrity.test.ts` holds both indexes to one row per ADR number, rows that link existing files with matching numbers, the same set of numbers in both languages, and every ADR source file reachable from the index.
