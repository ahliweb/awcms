🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0119-the-latest-badge-is-decided-not-inherited.id.md)

# ADR-0119 — the "Latest" badge is decided, not inherited

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decision maker:** ahliweb
- **Extends:** [ADR-0117](0117-latest-moves-only-after-the-approval-that-signs-it.md). That ADR made the container tag `:latest` move only after approval. This one covers the OTHER "latest" in the same workflow — the GitHub Release badge — which it did not consider and which fails in the opposite direction.
- **Related:** `.github/workflows/release.yml` §`sign-attest-publish`; `scripts/release-latest-flag.ts`; `scripts/lib/release-verify-checks.ts` (`shouldMarkReleaseLatest`); `tests/release-latest-flag.test.ts`; release runs 31547796968 (`v8.1.0`), 33033515836 (`v10.0.0`), 33052902887 (`v10.0.1`)

## Context

### Two different things are called "latest", and ADR-0117 only fixed one

ADR-0117 established that the **container tag** `:latest` must not move until the
approval that signs the image has been given. It succeeded: on 28 August 2026
`gh attestation verify oci://ghcr.io/ahliweb/awcms:latest` returns exit 0, and
`:latest` resolves to the signed `v10.0.4` digest.

The **GitHub Release badge** is a separate mechanism with a separate failure
mode, and `release.yml` never made a decision about it:

```bash
gh release create "${{ github.ref_name }}" \
  --title "${{ github.ref_name }}" \
  --notes-file release-notes.md \
  CHECKSUMS.txt sbom-source.cdx.json sbom-image.cdx.json source.tar.gz
```

No `--latest` flag. `gh` documents the default as "automatic based on date and
version", and in practice a freshly created release takes the badge. That
default encodes an assumption: **releases only ever move forward.**

### This repo breaks that assumption BY DESIGN, and ADR-0117 is why

The `release` environment gate exists so a human signs before publication. A
gate a human must reach is a gate that can be reached late — and in this repo it
routinely was, by days or weeks. So the order in which releases are _published_
is not the order in which their versions were _created_, and cannot be.

ADR-0117 accepted that consequence explicitly: it declined to repair the stalled
runs it found, because "a tag-push run executes the workflow as of that tag". It
did not follow the consequence one step further, to what happens when somebody
eventually approves them.

### What happened, measured

On 28 August 2026 the three remaining parked runs — `v8.1.0` (waiting since 11
August), `v10.0.0` and `v10.0.1` — were approved to give their published images
the attestations they lacked. That worked: all three verify now.

It also moved the badge. Within seconds of `v10.0.0`'s release publishing,
`GET /repos/ahliweb/awcms/releases/latest` returned **`v10.0.0`** — a version
four releases superseded, and the one anything following that endpoint would
have resolved. Restored manually with `gh release edit v10.0.4 --latest`.

### Why nobody saw it coming, which is the more useful half

The move was predicted **not** to happen, on evidence that looked solid: four
releases had been backfilled the previous evening (`v8.0.0`, `v9.0.0`, `v9.1.0`,
`v9.1.1`, all published 22:05), and `GET /releases/latest` still reported
`v10.0.4`. The inference — "backfilling does not take the badge" — was wrong.
Those four **did** take it, and `v10.0.3` (22:36) and `v10.0.4` (23:06)
published an hour later and took it back.

**Final state cannot answer a question about ordering.** Two events that cancel
each other out are indistinguishable from one event that never occurred. This is
the same class as ADR-0117's own defect, which was the ordering of two
individually-correct jobs leaving no trace in any artefact — and it is why the
rule below is enforced by a test against the recorded incident rather than by
anybody's reading of the current state.

## Decision

**1. The flag is always passed, and always computed.** `gh release create`
receives an explicit `--latest=true|false`. Inheriting a default is what made a
superseded version authoritative; a default that is right most of the time is
still a decision nobody made.

**2. The rule: Latest only when no published release has a higher version.**
Drafts and pre-releases are excluded, because GitHub never puts the badge on
either — counting them would let a stale pre-release deny the badge to a
legitimate stable release. Tags outside `vX.Y.Z` are ignored on both sides; this
repo carries prefix-less legacy tags (`3.0.0`, `4.5.0`) and comparing a
non-version produces a meaningless ordering.

**3. The comparison is a pure function with tests, not shell in a `run:`
block.** `shouldMarkReleaseLatest` lives beside the other `release:verify`
checks; `scripts/release-latest-flag.ts` is only the I/O bridge — it reads
`gh release list --json tagName,isPrerelease,isDraft` from STDIN and prints one
word. Version comparison written inline in YAML is logic no test can reach, and
untested logic on the release path is precisely how this defect arrived.

**4. The bridge fails CLOSED, and closed here means `false`.** Unparseable
input, a non-array, an empty tag: print `false`. The asymmetry is deliberate. A
wrong `false` leaves a release without a badge — visible, and one
`gh release edit` from fixed. A wrong `true` moves the badge to the wrong
version and **nothing reports it**, which is the failure being eliminated.

**5. The badge is re-read after publishing, and the job fails if it disagrees.**
This step looks redundant. ADR-0117's amendment is the argument for it: there,
the mechanism chosen to guarantee a property broke that property on its first
run, and the only reason it was caught in the release that introduced it —
rather than by a consumer weeks later — was a re-read nobody thought necessary.

**6. `release.yml` is asserted, not trusted.** `tests/release-latest-flag.test.ts`
reassembles every real `gh release create` invocation from its continuation
lines and requires an explicit `--latest=`. It excludes comment lines on
purpose: this workflow discusses `gh release create` in prose twice, so a plain
substring search finds a comment first and answers a question about
documentation while appearing to answer one about behaviour.

## What is NOT done

**The three approved releases are not re-ordered.** `v8.1.0`, `v10.0.0` and
`v10.0.1` keep their Releases and their attestations; only the badge was moved
back, and it now sits on `v10.0.4` where it belongs.

**Nothing prevents a release from publishing out of order.** That is not a
defect — it is the direct consequence of a human approval gate, and ADR-0117
chose it deliberately. What changes is that publishing out of order no longer
silently changes what "latest" means.

**No `make_latest: legacy` mode.** GitHub offers a date-based variant. It would
have produced the right answer here by accident, and would produce the wrong one
the first time a patch on an older line is released after a newer major —
`v9.1.3` published after `v10.0.4` is exactly the case this repo's support
policy makes likely.

## Consequences

- Approving a parked run, backfilling a historical release, or shipping a patch
  on an older line no longer disturbs what consumers resolve as latest.
- One extra `gh release list` call and one extra `gh api` call per release.
- A release whose version is not the highest publishes with no badge at all,
  which is correct and is what the verification step asserts.
- The incident is encoded as a test fixture (`AS_IT_STOOD`) rather than as
  prose, so the rule is checked against what actually happened rather than
  against a remembered version of it.
