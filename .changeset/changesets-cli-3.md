---
"awcms": patch
---

chore(deps-dev): @changesets/cli 2.31.1 -> 3.0.0

A major bump of the tool this repo's whole versioning policy runs on, so it was
exercised rather than assumed: `changeset --version` reports 3.0.0,
`changeset status` parses `.changeset/config.json` and every pending changeset
file without complaint, and the repo's own `changesets:policy:check` behaves
exactly as before (it fails this branch for the one correct reason — a
dependency bump with no changeset — and passes once this file exists).

Stated plainly rather than implied: `changeset version` — the command that
consumes changesets and rewrites `package.json` + `CHANGELOG.md` — is only
fully exercised at release time, not in CI. The next release is where a v3
behaviour change would surface, and the release flow is already a separate,
isolated PR (`chore(release): vX.Y.Z`) precisely so that a surprise there
cannot be entangled with feature work.
