---
"awcms": patch
---

chore(actions): bump docker/setup-buildx-action to v4.4.1

Release-pipeline only: `.github/workflows/release.yml` uses this action to prepare the
buildx builder before the image build steps. It has a single pinned usage, moved to
`f87e5991a6d7451dcb8d9637bfbc97413f497069`, and does not run on pull-request paths, so
it cannot affect application behaviour.
