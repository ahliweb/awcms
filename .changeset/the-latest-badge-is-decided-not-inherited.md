---
"awcms": patch
---

fix(release): the "Latest" badge was inherited from a default that assumes releases move forward

ADR-0117 stopped the container tag `:latest` moving before the approval that
signs it, and it worked — `:latest` verifies clean against `v10.0.4`. It did not
consider the OTHER "latest" in the same workflow.

`gh release create` was called with **no `--latest` flag**, so it inherited
GitHub's default. That default encodes an assumption: releases only ever move
forward. **This repo breaks that assumption by design** — the `release`
environment gate exists so a human signs before publication, and a gate a human
must reach is a gate that can be reached late. ADR-0117 accepted exactly that
consequence; it did not follow it one step further, to what happens when
somebody eventually approves a run that has been parked for two weeks.

On 28 August 2026 the three remaining parked runs (`v8.1.0`, waiting since 11
August, plus `v10.0.0` and `v10.0.1`) were approved so their published images
would get the attestations they lacked. That worked. It also moved the badge:
within seconds `GET /releases/latest` returned **`v10.0.0`** — a version four
releases superseded, and what anything following that endpoint would resolve.

## Why it was not predicted, which is the useful half

It was predicted *not* to happen, on evidence that looked solid: four releases
had been backfilled the previous evening and `/releases/latest` still reported
`v10.0.4`. The inference — "backfilling does not take the badge" — was wrong.
Those four **did** take it, and `v10.0.3` and `v10.0.4` publishing an hour later
took it back.

**Final state cannot answer a question about ordering.** Two events that cancel
out are indistinguishable from one that never occurred — the same class as
ADR-0117's own defect, which was the ordering of two individually-correct jobs
leaving no trace in any artefact.

## What changed (ADR-0119)

- The flag is **always passed and always computed**. Latest only when no
  published release has a higher version; drafts and pre-releases excluded
  (GitHub never badges either); non-`vX.Y.Z` tags ignored on both sides, because
  this repo carries prefix-less legacy tags.
- The comparison is a **pure function with tests** — `shouldMarkReleaseLatest`,
  beside the other `release:verify` checks — not shell inside a `run:` block.
  Untested logic on the release path is how this arrived.
- The I/O bridge **fails closed to `false`**, asymmetric on purpose: a wrong
  `false` leaves a release unbadged, which is visible and one `gh release edit`
  from fixed; a wrong `true` moves the badge and nothing reports it.
- The badge is **re-read after publishing** and the job fails if it disagrees —
  ADR-0117's amendment lesson applied in advance rather than after.
- `release.yml` is **asserted, not trusted**: the test reassembles every real
  `gh release create` invocation from its continuation lines and requires an
  explicit `--latest=`, excluding comments, because the workflow discusses the
  command in prose twice and a substring search finds a comment first.

The rule is tested against the incident as it actually stood, and the parity
test was proven to go red with the flag removed.
