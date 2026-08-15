🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0068-family-standards-posture-editions-and-recorded-divergences.id.md)

# ADR-0068 — Family standards posture: editions pinned here, and three divergences recorded

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision maker:** @ahliweb
- **Related:** [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (family compatibility manifest + divergence mechanism), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (development confined to two repos), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (a rule with no checker will be broken), `awcms-astro` ADR-0028 (that repo states it follows this repo's OWASP edition), `awcms-astro` ADR-0029 (HSTS without `includeSubDomains` over there)

## Context

### 1. The neighbouring repo is waiting on a decision that was never taken here

`awcms-astro` ADR-0028 §A states, in writing, that it **matches its OWASP
edition to this repo's and will not get ahead of it**. The reasoning is right:
two family repos mapping themselves to two different editions produce two
matrices that cannot be added together, and a reader will read the numbering
difference as a control gap.

The problem is that the decision it follows **never existed**. The OWASP Top 10
**2021** and ASVS **4.0.3** pins in this repo come from the
`awcms-security-hardening` skill — written when those were the latest editions,
then followed because they were already written down. No ADR, no review date, no
owner.

So one repo is waiting for a signal from another repo that does not know it
holds that signal. That is not a technical difference; it is an orphaned
decision.

### 2. Two real differences from `awcms-astro`, and its divergence list is empty

[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) has
had a complete divergence mechanism since ADR-0032 — `id`, `summary`, `reason`,
`owner`, `reviewDate`, `adr` — with a gate that **fails when the `reviewDate`
has passed or the ADR is missing. The list is **empty**, and the file itself
writes that "a contract this repo has to diverge on — `awcms-astro`'s, for
example — will fill it in".

Meanwhile there are two differences that are real, deliberate, and unrecorded on
this side:

- **HSTS.** This repo sends `max-age=31536000; includeSubDomains`; `awcms-astro`
  sends `max-age=31536000` only (its ADR-0029). **Both are correct**: this repo
  is ONE deployment whose operator knows its subdomains, that repo is a TEMPLATE
  running on an organisation's domain that almost certainly has other services on
  other subdomains — and `includeSubDomains` forces all of them to HTTPS-only for
  a year in every visitor's browser, a consequence borne by services whose owners
  took no part in the decision.
- **`.astro` type checking.** `awcms-astro` runs `astro check` in its `check`
  chain. This repo **cannot**, and the reason is external — see §3.

### 3. `astro check` cannot be run here, and that is not negligence

The 4 August 2026 assessment §9.4 records a real gap: **42 `.astro` files
(22,328 lines)** — all 31 admin screens, the login page, the public pages — have
never been type-checked. `tsc` cannot parse `.astro` and skips them silently even
though `tsconfig.json` writes `"include": ["src/**/*"]`, and `astro build` does
not type-check.

The obvious fix is to add `astro check`. It was tried, and it **refuses to run**:

```
The TypeScript module loaded (found 7.0.2) does not expose the programmatic API
that `astro check` relies on. TypeScript's native compiler (7.0 and later) does
not ship this API yet.
```

This repo uses TypeScript **7.0.2**; `@astrojs/check` demands a programmatic API
that only exists in TypeScript **6.x**. `awcms-astro` uses TypeScript `^6.0.3`,
and that is the only reason it can run a gate this repo cannot. The difference is
**not discipline**, it is toolchain version.

Downgrading TypeScript to 6.x to satisfy this gate is rejected: it regresses the
whole repo's toolchain — 33 gates, ~156,000 lines, and a `tsc --noEmit` that is
clean today — for the sake of one checker that is not even guaranteed to be clean
the first time it runs.

## Decision

### §A — Pinning standard editions is this repo's decision, and it is now written down

| Standard                  | Edition         | Review again |
| ------------------------- | --------------- | ------------ |
| OWASP Top 10              | 2021            | 2027-02-04   |
| OWASP ASVS                | 4.0.3 (L1/L2)   | 2027-02-04   |
| OWASP API Security Top 10 | 2023            | 2027-02-04   |
| ISO/IEC 27001             | 2022, Annex A   | 2027-02-04   |
| NIST SSDF                 | SP 800-218 v1.1 | 2027-02-04   |

**Raising an edition is a family-level decision and needs its own ADR**, because
it re-maps the entire matrix in
[`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.md)
§3–§7 **and** requires `awcms-astro` to be told in the same breath. Until that
ADR is written, the pins above hold — and what changes today is that they **read
as pins**, not as being up to date.

What is **not** decided here: whether a newer edition is worth taking. That is
mapping work, not naming work, and mixing it into this ADR would make the
decision "we use edition X" and the decision "we have re-mapped to edition X"
live in one file when the second is far more expensive.

### §B — Three divergences recorded in the manifest, with review dates that bite

`awcms-family-compatibility.yaml` gets an entry for each. The gate
`bun run family:conformance:check` **already** rejects an entry whose
`reviewDate` has passed or whose ADR does not exist, so all three automatically
come back to the table on their date — without anyone having to remember.

What makes this recording valuable is not tidiness: a difference that is not
recorded will be **rediscovered as a finding** six months later, and "fixed" in
the wrong direction. `includeSubDomains` especially: copying it into
`awcms-astro` for the sake of "family parity" is a one-word change that moves a
context-dependent decision into a place that does not have its context.

### §C — `.astro` stays unchecked, and that is declared as dated debt

Not "we will get to it later", but a divergence with a `reviewDate` that reddens
CI when it comes due. What is being waited on is external — TypeScript 7 support
in `@astrojs/check` — so the date is when we **re-check**, not when we promise to
be done.

Until that happens, the mitigation is not hope: the `awcms-testing` and
`awcms-pr-review` skills already carry the instruction that a diff touching
`.astro` must have its types read by eye, together with the defect class most
likely to slip through (`withTenant` where `withTenantOrThrow` belongs).

## Consequences

**What is gained.** The neighbouring repo stops waiting on a decision that does
not exist. Three differences have a name, a reason, an owner, and a date — and an
already-existing gate enforces all three without one line of new mechanism.

**What is paid.** Three `reviewDate`s that will redden CI on their day, and
someone has to actually answer them. That is a deliberate cost: the alternative
is a record that rots silently, and this repo already has plenty of evidence
about how that ends.

**What is NOT done.** Zero header changes, zero toolchain changes, zero matrix
re-mapping. This ADR names the state; it does not change it.

## Alternatives considered

- **Downgrade TypeScript to 6.x so `astro check` runs.** Rejected — see §3.
  Regressing the whole repo's toolchain for one checker is trading a known defect
  for an unknown risk.
- **Raise the OWASP edition in this ADR while we are at it.** Rejected: re-mapping
  §3–§7 is real work whose output has to be checked line by line, and merging it
  in would make this ADR indistinguishable from work that claims more than it
  does.
- **Copy `includeSubDomains` into `awcms-astro` for parity.** Rejected, and
  ADR-0029 in that repo already writes the reason better than it could be written
  from here.
- **Leave the edition pins living in the skill alone.** Rejected: skills are
  FOLLOWED, not negotiated. A family-level decision that lives only inside a
  guidance page will be dismantled by the next person who edits that page,
  without realising another repo is bound to it.
