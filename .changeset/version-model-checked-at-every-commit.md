---
"awcms": minor
---

The `vX.Y.Z` model is now checked at every commit, not only after the tag is public

The model was real and already enforced — by one regex, on the release path, in
a step that runs *because* a tag was pushed. That ordering was the defect. Every
way of getting the version wrong (`package.json` bumped by hand to `9.2`, a
prerelease suffix, a CHANGELOG section nobody wrote) stayed green through all 51
gates on `main` and surfaced only after `git push origin vX.Y.Z` — at which
point the tag is public, and `release-process.md` §Yanking is explicit that this
repo does not force-push a corrected tag over a published one. The cheapest
failure was reachable only at the most expensive moment.

The tag namespace shows the cost. Six tags do not match the model — `2.9.9`,
`2.12.0`, `3.0.0`, `3.1.0`, `4.3.1`, `4.5.0` — and `3.0.0` sits on commit
`b23d3308` beside `v3.0.0`: one release under two names. Nothing reported any of
it, because nothing was looking.

**`bun run version:check` (gate 52)** applies the model continuously: eight
rules covering `package.json`, CHANGELOG heading validity/ordering/agreement,
the tag namespace, and the pending changesets. Two of them are about a version
number that has already been published — `version-behind-tags` catches a revert
that drops `package.json` below the newest tag, from where the next bump
re-issues a number that is taken.

**`scripts/lib/semver.ts`** is now the single definition of the model, shared by
the new gate and by `release:verify`. Extracting it closed a real hole: the
pattern it replaced, `/^v(\d+\.\d+\.\d+)$/`, accepted `v01.2.3` — and SemVer §2
forbids leading zeros for precisely the reason this repo can already demonstrate
on `b23d3308`, that one release under two spellings is one release nobody can
name unambiguously.

Three narrower fixes went with it:

- **`release:verify` resolves its tag deterministically.** The local fallback
  used `git describe --tags --exact-match`, which on the double-tagged commit
  picks by git's internal ordering rather than by the model, then fails with
  "does not match vX.Y.Z" naming a tag nobody chose — with nothing in the
  message identifying the second tag as the cause. It now filters
  `git tag --points-at HEAD` to release tags, and says so when the choice is
  genuinely ambiguous.

- **The `v*.*.*` trigger is bound to its backstop.** The glob matches
  `v1.2.3-rc.1`, and a glob cannot express "no prerelease", so `release:verify`
  is the only thing standing between a prerelease tag and a signed, attested,
  published release. Deleting that step is now a gate failure rather than a
  silent fail-open.

- **`ci.yml` fetches tags.** A default checkout is shallow and fetches none, so
  the tag rule would have reported `UNENFORCED` forever — green, and blind, the
  same shape as a coverage gate that passes because it sees nothing. The rule
  now has data in CI, and a test asserts the `fetch-tags: true` line is still
  there so it cannot be removed quietly.

The six legacy tags are a closed exact-name exemption list citing ADR-0024, not
a pattern hole: a seventh cannot appear without someone editing the list. Every
tag cut since `v5.1.0` (2026-07-16) already conformed — 15 of 15. This makes
that a checked invariant instead of a streak.

Two rules were deliberately left out because they would have been red on
arrival for reasons that are history rather than drift: "every CHANGELOG version
has a tag" (`5.0.0` and `0.2.0` correctly have none — ADR-0024 §4) and "every
tag has a CHANGELOG section" (`v3.0.0`–`v4.6.0` are pre-rebuild). A gate whose
first act is to demand a `--force` flag teaches everyone to pass one.
