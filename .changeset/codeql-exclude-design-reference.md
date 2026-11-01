---
"awcms": patch
---

Exclude the reference-only `design/` folder from CodeQL via `.github/codeql/codeql-config.yml`, closing 27 false-positive code scanning alerts (#172-#198): `js/useless-expression` on the Design Component `onClick="{{...}}"` template placeholders, and `js/missing-origin-check` on `support.js`, a byte-identical vendor copy. Nothing under `src/` is excluded; the workflow's `State coverage` step counts files with the same exclusion, and a test pins the exclusion list to `design` alone. No runtime behaviour changes.
