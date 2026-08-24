---
"awcms": patch
---

chore(deps-dev): @changesets/cli 3.0.0 -> 3.0.1

A patch on the tool this repository's whole versioning policy runs on, so it was
exercised rather than assumed: `changeset --version` reports 3.0.1 and
`changeset status` parses `.changeset/config.json` and every pending changeset
file in the directory without complaint. The repo's own
`changesets:policy:check` — which is our script, not the CLI's — behaves exactly
as before.

The same caveat as the 3.0.0 bump still holds and is worth restating rather than
implying: `changeset version`, the command that consumes these files and
rewrites `package.json` + `CHANGELOG.md`, is only fully exercised at release
time, not in CI. The release flow is a separate, isolated pull request by
design, so a surprise there cannot be entangled with feature work.
