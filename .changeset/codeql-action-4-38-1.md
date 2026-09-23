---
"awcms": patch
---

chore(actions): bump github/codeql-action to v4.38.1 in ONE change, because its two halves cannot land separately

`.github/workflows/codeql.yml` pins `github/codeql-action/init` and
`github/codeql-action/analyze` to the same commit SHA. Dependabot treats those as two
independent dependencies and opened two PRs for them (#811 for `init`, #809 for
`analyze`), each moving one line.

Either one merged ALONE breaks CodeQL on `main`, and does so in a way that is easy to
misread as a flaky scanner rather than a half-applied bump:

```
##[error]Loaded a configuration file for version '4.38.1', but running version '4.37.9'
##[error]analyze post-action step failed: Loaded a configuration file for version '4.38.1', but running version '4.37.9'
```

`init` writes a config file stamped with its own version and `analyze` refuses a config
from a version it is not. They are two halves of one atomic change, so this changeset
moves both lines to `1c5b675653bb5c22dbe9b12b556ec555138e09fd` (v4.38.1) together, and
#811/#809 are closed in favour of it.

The rule this leaves behind: any future `codeql-action` bump must move BOTH pinned
SHAs in the same commit. A dependabot PR that touches only one of them is not
independently mergeable no matter how green the rest of its checks look — the CodeQL
jobs are `skipping` on the PR itself and only turn red after the merge lands on `main`.
