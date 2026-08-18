---
"awcms": patch
---

chore(actions): codeql-action init and analyze move to 4.37.7 together

Dependabot always splits `github/codeql-action/init` and `/analyze` into two
pull requests, and each one fails on its own: CodeQL requires every
`codeql-action` step in a workflow to run the SAME version, so a lone bump
produces `Not all workflow steps that use github/codeql-action use the same
version` and `Loaded a configuration file for version 'X', but running 'Y'`.

Both steps therefore move to the same commit SHA
(`ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd`) in one change, and the sibling PR
is closed rather than merged after it.
