🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0047-mini-micro-frozen-foundation-built-here.id.md)

# ADR-0047 — `awcms-mini` and `awcms-micro` are frozen as reference; foundation features are built directly here

- **Status:** Superseded by [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
- Date: 2026-07-31
- Related: [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  (direct-use templates, no mandatory derived repos), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md)
  (online-first ERP/SaaS superset positioning), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
  (`awcms` is the system of record, `awcms-astro` is the experience layer).
  Amends the **mini-first** rule stated in [`AGENTS.md`](../../AGENTS.md)
  §"Relationship with awcms-mini" and [`docs/awcms/alur-pengembangan-mini-first.md`](../awcms/alur-pengembangan-mini-first.md).

> **Read as history.** This ADR froze `awcms-mini`/`awcms-micro` as a reference
> that could **still be ported OUT of**. [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
> (2 August 2026) closed that path too: both are **ARCHIVES**, and a capability
> that is wanted is **built here** under its own admission ADR. §Decision item 1
> below ("Reading and porting _out_ stay encouraged") therefore **no longer
> applies** — its wording is deliberately not rewritten, per Rule 2 of the ADR
> index (a replaced ADR is **marked**, not deleted and not rewritten). See also
> [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
> for the roles the two surviving repos carry today.

> **Numbering note.** `0046` is deliberately skipped: it is reserved by
> in-flight work (`feat/idn-admin-regions-module`) that had not landed on `main`
> when this ADR was written. Taking the next free number on `main` would have
> collided with it. ADRs are never renumbered, so a reserved gap is cheaper than
> two documents claiming the same identity.

## Context

`AGENTS.md` states the development pathway for this repository in two sentences
that, together, forbid starting foundation work here:

> "Foundation features are proven first in awcms-mini, then ported into this repo."
>
> "This repo is not the place to pioneer foundation features from scratch."

That rule was correct for the conditions that produced it: `awcms-mini` was the
standard repo where foundation capability was proven cheaply, and this repo
absorbed it afterwards with a documented rename pass.

Those conditions no longer hold. **As of 31 July 2026 the maintainer has frozen
`ahliweb/awcms-mini` and `ahliweb/awcms-micro` as reference-only**: they may be
read, their patterns may be copied, code may be ported _out_ of them — but they
do not receive changes. Development lands in `awcms` and `awcms-astro`.

### The consequence that forced this ADR

A freeze alone is a scheduling statement. Combined with the mini-first rule it
becomes something else entirely: **foundation work has nowhere to land at all.**

This is not hypothetical, and it is worth recording precisely because it was
discovered by walking into it rather than by reading the rules.

`awcms-astro` cannot currently fetch content from this repository. Two contract
defects, both verified against the live staging instance rather than inferred
from documentation:

1. **The tenant header does not match.** `resolveAuthInputs` reads
   `x-awcms-tenant-id`; `awcms-astro` sends `X-Tenant-Code`/`X-Tenant-Id`.
   Probed against `awcms-staging`: every value of `X-Tenant-Code` returns
   `400 TENANT_REQUIRED`, while `x-awcms-tenant-id` reaches `401 AUTH_REQUIRED`.
2. **No credential exists that a build can hold.** The bearer accepted by
   `/api/v1/blog/posts` is a hashed **session** token. This repo's schema has
   `awcms_sessions` and no table of machine tokens; neither does `awcms-mini`.
   `awcms-astro`'s `.env.example` instructs operators to issue "a BUILD-TIME,
   READ-ONLY token" that nobody can issue.

Fixing (2) means a machine-credential concept — unambiguously a foundation
feature in `identity-access`. Under mini-first it belongs in `awcms-mini` first.
Under the freeze, `awcms-mini` may not be touched. The work is therefore blocked
by the intersection of two rules that are each individually sensible.

The same intersection blocks the **cross-origin session-introspection contract**
that [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
already decided and that `awcms-astro`'s readiness checklist names a _hard_
dependency: without it a portal proof-of-concept can only fake a session, and a
proof-of-concept that fakes its hardest part proves nothing.

So this is not a preference about where code feels natural. It is a deadlock,
and it has two live victims.

## Decision

1. **`awcms-mini` and `awcms-micro` are reference-only while the freeze holds.**
   Reading and porting _out_ stay encouraged; sending changes _in_ does not
   happen.

2. **Foundation features are prototyped directly in `awcms`** for the duration.
   The mini-first pathway in `AGENTS.md` and
   [`docs/awcms/alur-pengembangan-mini-first.md`](../awcms/alur-pengembangan-mini-first.md)
   is **suspended, not deleted** — it resumes unchanged when the freeze lifts.

3. **Every safeguard the mini-first route carried implicitly is now explicit.**
   Removing a route is not removing its guardrails. Foundation work landed here
   during the freeze still requires, without exception:
   - an ADR when it changes a standard (`GOVERNANCE.md` §2);
   - the additional security review that `AGENTS.md` requires for the
     `auth`/`access`/`sync` modules — and a machine-credential table is squarely
     inside that set;
   - `bun run check` in full, including `family:conformance:check`;
   - OpenAPI/AsyncAPI kept in step, RLS `FORCE` on every tenant-scoped table,
     and default-deny ABAC on every non-public endpoint.

4. **Each foundation feature landed during the freeze is a deliberate
   divergence** from the family baseline and is recorded as such in
   [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml)
   at the time it lands — not retroactively. A divergence that is only
   discovered when the freeze lifts is a merge conflict wearing a schema.

5. **When the freeze is lifted, the first decision to take is repatriation**:
   how the capability built here returns to `awcms-mini` as the family baseline,
   including the `awcms_…` → `awcms_mini_…` rename direction, which is the
   reverse of the documented port. That decision gets its own ADR.

## Consequences

**Unblocked.** The two contracts `awcms-astro` is waiting on may now be built
here: the machine-credential + build-feed pair, and the session-introspection
endpoint from ADR-0045. Both land in `identity-access` and both need machine
credentials, so they are one design conversation rather than two — and building
them separately would mean opening this repository's auth path twice.

**Accepted cost — divergence debt.** Every foundation feature added here while
the freeze holds widens the gap between this repo and the family baseline. That
debt is real and it compounds silently, which is exactly why point 4 requires it
to be recorded as it accrues. `family:conformance:check` is what stops the
record from being optional.

**Accepted cost — drift in the reference repos.** `awcms-mini` and
`awcms-micro` stop tracking the foundation. Their value as _reference_ decays
over time; anyone reading them for a pattern after this date should confirm the
pattern still holds here.

**Risk, named so it can be refused.** "Prototyped directly here" is easy to
misread as "held to a lighter standard here". It is not, and point 3 exists to
make that difficult to claim in a review. The mini-first route was never the
only thing making foundation work safe — it was one of several — and it is the
only one being suspended.

## Alternatives considered

**Keep mini-first and wait.** Rejected: the freeze makes the upstream unable to
receive the work, so "wait" has no end condition. It would leave `awcms-astro`
permanently unable to fetch its own content while both repos look healthy.

**Unfreeze `awcms-mini` only for foundation work.** Rejected: it contradicts the
directive, and it splits foundation attention across two repositories at exactly
the moment the maintainer consolidated it into two. It also reintroduces the
port step for every change, which is the cost the freeze is meant to avoid.

**Build the machine credential in `awcms-astro` instead.** Rejected outright:
`awcms-astro` is a static public site with no database and no identity store.
Placing a credential concept there would put a token issuer in the one repo of
the pair whose entire premise is having nothing to protect at runtime.
