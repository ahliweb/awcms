---
"awcms": patch
---

fix(data_lifecycle): the generic purge deletes by the table's real primary key instead of assuming an `id` column (Issue #1342). The key columns are read from the catalog once per process (identifiers validated and quoted, composite keys supported); a table without a primary key is refused with a clear error and nothing is deleted. No schema, API or event change; batch semantics, legal-hold re-check, cursor handling and the maintenance work class are unchanged.
