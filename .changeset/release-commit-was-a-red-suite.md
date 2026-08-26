---
"awcms": patch
---

test(version-check): the non-vacuity guard made a release commit a red suite

`every pending changeset has valid frontmatter` asserted `pending.length > 0`
on the live repo. That holds on every commit except the one it exists to
protect: a release consumes every changeset, so `.changeset/` is legitimately
empty and the assertion fails precisely when the repo is in the state the whole
version model is built around.

It had never fired because the test landed **after** v9.1.2, and v10.0.0 is the
first release since — the first time it was ever asked the question. Combined
with `changesets:policy:check`, whose release-consumption carve-out requires the
release commit to touch `package.json` and nothing else, a release PR could not
be green: fixing the test inside the release commit breaks the policy gate, and
leaving it breaks the suite. This fix has to land BEFORE a release, not with it.

Non-vacuity moves onto the READER, against a planted directory: one real
changeset plus the `README.md` it must skip, and an empty `.changeset/` proving
that zero pending is a release rather than a failure. The live-repo assertion
keeps checking frontmatter validity, which is what it was for.
