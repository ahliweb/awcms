---
"awcms": patch
---

chore(actions): bump docker/build-push-action to v7.4.0

Release-pipeline only: `.github/workflows/release.yml` uses this action to build and
publish the container images. It is not on any path that runs for a pull request, so
the bump cannot affect application behaviour.

The action is pinned in TWO places in that workflow (the app image and the
`awcms-jobs` image). Dependabot moved both to
`c3c9e263c25d99ce0380d002d59b67737d91b0dc` in one commit, which is what makes this
bump independently mergeable — unlike a `codeql-action` bump, where dependabot splits
the two pinned SHAs across separate PRs and neither half is safe alone (see #817).
