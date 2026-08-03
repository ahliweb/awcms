---
"awcms": patch
---

Bump `github/codeql-action` from 4.37.3 to 4.37.4 (`init` and `analyze`
together).

Dependabot raises these as two PRs because they are two action paths, and
neither can go green alone: `init` and `analyze` must run from the SAME commit,
so each half-bump fails both Analyze jobs with a version mismatch. Landing them
in one commit pinned to one SHA is the only shape that passes.
