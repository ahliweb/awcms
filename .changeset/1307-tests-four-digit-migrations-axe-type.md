---
"awcms": patch
---

fix(tests): the migration-order tests compare with `compareMigrationNames` (numeric) instead of `localeCompare`, so they keep passing once four-digit migration names exist, and the axe e2e smoke derives its violation type from `AxeBuilder["analyze"]` instead of importing the undeclared transitive `axe-core` package (Issue #1307). `MIGRATION_FILE_PATTERN` is unchanged: two-digit and five-digit prefixes are still refused. Tests only.
