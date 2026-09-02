---
"awcms": patch
---

chore(actions): bump github/codeql-action to 4.37.9 and anchore/sbom-action to 0.24.2 — as one change, because half a CodeQL bump breaks CodeQL

Dependabot opened these as three PRs (#758, #759, #760) and **two of them were
individually un-mergeable, for a reason no single PR could show.**
`github/codeql-action/init` and `.../analyze` are pinned to the same SHA and
must stay that way: `init` writes a config file stamped with its own version and
`analyze` refuses to read one from a different version. #759 moved `analyze`
alone and #760 moved `init` alone, so each PR's own CodeQL run failed with
`Loaded a configuration file for version '4.37.8', but running version
'4.37.9'`. Merging either one first would have put that failure on `main`.

Both halves move here in one commit. `anchore/sbom-action` (0.24.0 → 0.24.2,
both call sites in `release.yml`) joins them because it is the same class of
change and was blocked only by the changeset gate, which correctly does not
exempt workflow files.

No behaviour change to the application; this touches CI and release plumbing
only. The SHAs are the ones Dependabot resolved, unchanged.
