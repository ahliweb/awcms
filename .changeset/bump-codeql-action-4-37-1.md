---
"awcms": patch
---

chore(ci): bump `github/codeql-action` (`init` + `analyze`) from 4.37.0 to
4.37.1. Both steps are bumped together in the same workflow — CodeQL requires
every `github/codeql-action/*` step to run the identical version, so a split bump
(dependabot opened `init` and `analyze` as separate PRs) fails the Analyze job
with a version-mismatch error. This supersedes the separate `init`-only PR.
