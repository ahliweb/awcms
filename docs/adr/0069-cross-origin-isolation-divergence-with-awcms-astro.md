🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0069-cross-origin-isolation-divergence-with-awcms-astro.id.md)

# ADR-0069 — The COOP/CORP difference with `awcms-astro` is recorded as a divergence

- **Status:** Accepted
- **Date:** 2026-08-05
- **Decision maker:** @ahliweb
- **Related:** [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) (the mechanism for recording family divergences), [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (the compatibility manifest), `awcms-astro` ADR-0028 (that repo's standards posture; CORP is listed as a control REJECTED for a template)

## Context

Closing gap C2 (4 August 2026, commit `769292d7`) made this repo
send two cross-origin isolation headers on **every** response, with no
production gate:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

`awcms-astro` **sends neither**, and that is not an oversight:

- **CORP is explicitly rejected there** — "blocking other sites from embedding
  images from this site is a decision that does not belong to a TEMPLATE"
  (the list of rejected controls in that repo's standards document, quoted in
  its ADR-0028 as well). A derived site that wants it adds it via an ADR
  in its own site repo.
- **COOP is irrelevant to its surface** — that repo has no session to
  fence off; every page of it is public navigation. That repo's standards
  document (updated by PR #40 over there) now records why this repo's posture
  "does not spread to here" in its own words.

So the difference is **deliberate on both sides and documented on both sides** —
but not yet recorded in the one place that has a review date and an
expiry gate: `intentionalDivergences` in
[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml).
The ADR-0068 precedent fits this case exactly: an unrecorded difference will
be rediscovered as a finding and "fixed" in the direction of parity by someone
who does not hold the context. Gap **C15** in
[`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.md)
§9 demands precisely this entry.

## Decision

1. One new divergence entry `coop-corp-cross-origin-isolation` in
   `awcms-family-compatibility.yaml`, with an `owner`, a `reviewDate` of 2027-02-04
   (one cohort with the three ADR-0068 entries so the whole family posture
   returns to the table on the same date), and this ADR as its `adr`.
2. The direction of parity is **not** changed from here: this repo keeps sending both;
   `awcms-astro` keeps not sending them. If a site derived from that template
   needs COOP/CORP, the decision is born in that site's repo — not
   by copying this repo's values into the template.

## Consequences

- `bun run family:conformance:check` now enforces that this difference has
  an owner and a review date; past that date without a review, CI goes red.
- Gap C15 is closed in the standards document (its table row is kept with
  status CLOSED, per the §9 rule: a deleted row will be proposed again
  as a new finding).
- The incorrect-claim part of C15 was already closed earlier in the neighbouring repo
  (PR #40 over there fixed its header table before this ADR was written);
  what this ADR adds is a deadlined record on the manifest owner's
  side.
