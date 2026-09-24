---
"awcms": patch
---

chore(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.3

Dev-only tooling: this is the CLI behind `bun run changeset` and the release-time
`changeset version` step. It does not ship in the built application.

Worth stating because it is the one dev dependency that can bite the release process
rather than the build: `changeset version` consumes every `.changeset/*.md` and bumps
`package.json`, and the changeset policy gate only lets that through a narrow
carve-out where the version-only `package.json` edit is the sole non-exempt file. A
release PR must therefore stay pure.
