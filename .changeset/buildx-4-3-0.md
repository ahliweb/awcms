---
"awcms": patch
---

chore(actions): docker/setup-buildx-action 4.2.0 -> 4.3.0

Release-workflow only — the step that prepares the Buildx builder before the
production image is built and pushed to ghcr.io. Pinned by commit SHA, as every
action in this repository is, with the human-readable version kept in the
trailing comment.

The bump carries no repository change of its own; it needs this changeset only
because `.github/workflows/*.yml` is deliberately NOT exempt from the changeset
policy, so that a supply-chain move in the release path is never invisible in
the CHANGELOG.
