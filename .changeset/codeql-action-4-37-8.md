---
"awcms": patch
---

chore(actions): codeql-action init and analyze move to 4.37.8 together

The same split Dependabot produces every time: `github/codeql-action/init` and
`github/codeql-action/analyze` arrive as two separate pull requests, and each
one fails on its own because CodeQL requires every `codeql-action` step in a
workflow to run the SAME version — a lone bump reddens the Analyze job with
`Not all workflow steps that use github/codeql-action use the same version`.

Both steps therefore move to the same commit SHA
(`db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28`) in this one change, and the sibling
pull request carrying the other half is closed rather than merged.
