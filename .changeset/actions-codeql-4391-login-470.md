---
"awcms": patch
---

ci(actions): bump the SHA-pinned actions in range, `github/codeql-action/init` and `/analyze` 4.39.0 → 4.39.1 (one coupled pair, `codeql.yml`) and `docker/login-action` 4.6.0 → 4.7.0 (both `ghcr.io` login steps in `release.yml`). Each pin stays a full commit SHA with its version comment. Supersedes Dependabot PRs #1193, #1194 and #1195, which carried no changeset.
