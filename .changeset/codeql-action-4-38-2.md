---
"awcms": patch
---

chore(actions): bump github/codeql-action to v4.38.2 in ONE change, because its two halves cannot land separately

`.github/workflows/codeql.yml` pins `github/codeql-action/init` and
`github/codeql-action/analyze` to the same commit SHA. Dependabot treats those as two
independent dependencies and opened two PRs for them (#852 for `init`, #853 for
`analyze`), each moving one line.

Either one merged ALONE breaks CodeQL on `main` (`init` writes a config file stamped
with its own version and `analyze` refuses a config from a version it is not — see
the precedent in `.changeset/codeql-action-4-38-1.md` / #817), so this changeset moves
both lines to `2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` (v4.38.2) together, and
#852/#853 are closed in favour of it.

v4.38.2 only updates the default CodeQL bundle version (2.27.1); no workflow-level
behaviour change beyond that.
