🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md)

# ADR-0070 — Family roles: `awcms-astro` carries public pages and the USER admin surface

- **Status:** Accepted
- **Date:** 2026-08-08
- **Decision maker:** @ahliweb
- **Narrows:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) — the phrase "every admin screen" is narrowed to "every **SYSTEM** admin screen". ADR-0051 is **not** superseded: its core decision holds in full and none of its three replacement gates are loosened by even a little. Its file gets a marker banner; its sentences are not rewritten (Rule 2 of the ADR index).
- **Refines:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) — the `awcms-astro` column in the two-repo role table there gets its correct content, via a marker banner in the same way. Points 1–5 of its §Decision are unchanged.
- **Related:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0050](0050-bff-session-handoff-code.md) (session handoff code), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (frozen consumer contract), [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) (mechanism for recording family divergences), `awcms-astro` ADR-0034 ([`docs/adr/0034-publik-secara-bawaan-admin-hanya-bila-dinyatakan.md`](https://github.com/ahliweb/awcms-astro/blob/main/docs/adr/0034-publik-secara-bawaan-admin-hanya-bila-dinyatakan.md))

## Context

On 8 August 2026, `awcms-astro` landed ADR-0034: that repo is a **public**
site as its primary function, and it **may** carry an admin surface for a
**USER** — an author, a reviewer, a contributor — if the site declares it
through `permukaanAdmin` in `src/config/site.ts`. The `owner` role is **rejected
by a gate** there, and the template itself declares zero authenticated surfaces.

That ADR was not taken silently. Its §Relationship writes out the tension with
this repo openly, and closes it with a request that cannot be fulfilled from
there — as it read before that side updated it on 8 August 2026:

> **What has to be done on that side, and has not been:** this difference
> deserves to be recorded as a family divergence in `awcms`'s
> `awcms-family-compatibility.yaml`, following the `awcms` ADR-0068 pattern —
> with an owner and a `reviewDate`, so that it comes back to the table instead of
> being rediscovered as a finding. This repo cannot write that itself; what can
> be done here is to not pretend the difference does not exist.

This ADR is the answer.

### What actually collides

ADR-0051 §Decision reads:

> We decide that **every AWCMS admin screen — tenant as well as
> owner/internal/platform — is built in the `awcms` repo**, under `/admin/*`,
> using one admin shell, one session, one registry-based sidebar, and one
> CSP posture.

The axis of that sentence is **audience** — tenant versus owner/internal/platform.
The term "USER admin" does not appear in it at all, and that is not an
oversight: on 1 August 2026 the question simply did not exist yet. What ADR-0051
rejected was the ADR-0048 split, which put **owner/internal** screens in
`awcms-astro` — precisely the role that is **rejected by a gate** there today.

The next paragraph in the same ADR is already narrower than its decision
headline:

> What is revoked is only its role as the home of **internal** admin screens.

Those two sentences are not entirely the same, and the difference between them
is exactly the room in which the USER admin surface stands. But **a difference
that can only be seen by comparing two paragraphs is not a rule** — it is a
reading. The word "every" has to be narrowed in writing, or it will be used to
reject legitimate work, by a reader who is genuinely following the rules.

### Why this is not a security loosening

ADR-0051 itself supplies the reason:

> What holds back cross-tenant actions is the authorization gate, not the repo
> address where the button is drawn.

Because the repo is not an audience boundary, moving a screen does not move its
permissions — in either direction. That is what makes this narrowing cheap: what
determines who may do what remains default-deny RBAC/ABAC here, and a button
drawn by `awcms-astro` for a role that `awcms` rejects remains a rejected button.

## Decision

**We decide to change the axis of the screen split from AUDIENCE to WHAT IS
MANAGED**, and to state the family roles as follows.

| Repo                                                            | Role                                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | **System of record** — modular monolith, every authorization surface, every API, and **every SYSTEM admin screen** (modules, roles, tenants, audit trail, anything whose effect is cross-tenant) |
| [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | **Public pages as its primary function**, and **the USER admin surface if the site declares it**; still the experience layer + BFF, and **never the source of truth**                            |

`awcms-mini` and `awcms-micro` remain **ARCHIVES**, unchanged from
[ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) §1. The two
repos above are the whole family under development, and the pair of them is the
general-purpose replacement for the three old templates — not either of them
alone.

### 1. The boundary is WHAT IS MANAGED, not who uses it

This is the sentence that decides, and it deliberately does not name job titles:

- **SYSTEM admin** — screens that change something **outside the content of a
  single site**: modules, roles and permissions, tenants, platform
  configuration, the audit trail, datasets served to many tenants. Built **here**,
  under one `/admin/*` shell, one session, one registry sidebar, one CSP posture.
  Unchanged.
- **USER admin** — screens a user uses to do **their own part on one site**:
  writing an article, submitting it for review, managing their own profile. They
  **may** live in `awcms-astro`, and only if that site declares them.

The measure is not who uses the screen but **what it changes**. An `owner`
writing an article is doing USER work; an author who can edit the role list is
not doing USER work, whatever their job title is called.

### 2. `owner` never gets in through there, and that is gated there

`awcms-astro` rejects `owner` in `permukaanAdmin.peran` mechanically, not as
advice. This repo does not need to enforce it a second time — but this repo
**records it as a condition**: the narrowing in this ADR holds as long as that
gate exists there. If it is revoked, the difference changes character and its
divergence entry (§6) is what brings it back to the table.

### 3. ADR-0051's three replacement gates are UNCHANGED

Quoted in full, because this is the part most likely to be mistaken for having
been loosened too:

> 1. **An action whose effect crosses a tenant boundary must have a
>    platform-scoped gate in `awcms`**, not merely tenant RBAC. Permissions
>    seeded to the `owner` role of every tenant **must not** be enough to run it.
> 2. **A cross-tenant action must not enter the catalogue seeded to tenant
>    roles.** If an action changes data served to another tenant, its permission
>    is not a tenant permission.
> 3. **A platform-scoped screen remains subject to that gate**, and the
>    `requiredPermission` on its `navigation` entry must be that platform
>    permission — so that an ordinary tenant owner does not see the menu and,
>    more importantly, is still rejected by the endpoint if they guess the URL.

All three hold in full. ADR-0051's open finding for
`idn_admin_regions.dataset.configure`/`.restore` has been **closed**:
[ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) revoked the
HTTP surface of both (`sql/084`), then
[ADR-0053](0053-platform-scoped-permissions.md) brought them back as
`scope: platform` permissions (`sql/085`) and declared itself to satisfy points
1–3 above. This ADR changes nothing of that.

### 4. No capability exists only over there

Every capability a USER reaches through `awcms-astro` **must also be manageable
from `/admin/*` here**. This is the mirror rule of §2 and closes the same door
from the opposite direction: rejecting `owner` keeps the platform from being
reachable FROM there, and this rule keeps anything from ESCAPING to there.

The work order follows: **`awcms` first, always.** A feature that lands in
`awcms-astro` before its management screen exists here is a feature nobody can
turn off.

### 5. What does NOT change, stated so it is not read as changing too

- **`awcms-astro` is never the source of truth.** ADR-0045 §2 holds in full: the
  BFF orchestrates and projects; it never decides. This narrowing is about who
  may see a screen, not about who decides what they may see.
- **`awcms-astro` does not touch the `awcms` PostgreSQL directly.** There is no
  database there, and this ADR opens no new path to it.
- **[ADR-0050](0050-bff-session-handoff-code.md) now has a stated audience.** The
  session handoff code was written when ADR-0048 gave `awcms-astro`
  owner/internal screens; ADR-0051 revoked that role and left it with
  **diminished motivation** — ADR-0051 §Consequences states that the BFF work
  (ADR-0049/0050) "remains in use for its role in ADR-0045", but without naming
  which screens. Now the screens have a name, and their audience is stated
  explicitly: **USER, never `owner`.**
- **[ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) is not extended
  here, and that is deliberate.** `CONSUMER_PATHS` has two parts:
  `CONSUMED_PATHS` (called today) and `COMMITTED_PATHS` (promised via an ADR,
  deliberately frozen before any caller exists — the condition being "no ADR, no
  entry"). So the mechanism for promising a surface in advance does exist; what
  does not exist yet is **a shape that can be promised**. The USER admin surface
  does not have a single decided endpoint yet, so it is in neither. It follows
  later through ADR-0065's own path once its shape is decided.
- **[ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md)
  §"`awcms-astro` has no admin screens at all yet"** is a fact dated
  1 August 2026 and is **not edited**. It was true on that day, and even today
  the `awcms-astro` template still declares zero admin surfaces — what landed
  there is the permission, not the screen.

### 6. The difference is recorded as a family divergence, with a review date

Following the pattern of [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md)
and [ADR-0069](0069-cross-origin-isolation-divergence-with-awcms-astro.md):
the `admin-user-surface-in-awcms-astro` entry in
[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml),
with `owner: "@ahliweb"` and `reviewDate: "2027-02-04"` — in the same cohort as
four other entries so that the whole family posture is reviewed in one sitting.

Why this difference needs a review date while the decision above is already
firm: what is reviewed is not "may USER admin be over there" but **whether the
boundary is still in the same place**. A surface that grows one screen per
quarter is the most natural way a "USER admin" turns into a system admin without
anyone deciding it.

## Consequences

- **Positive:**
  - The word "every" in ADR-0051 stops being used to reject legitimate work. An
    agent reading `AGENTS.md` gets a rule that matches the decisions that
    actually hold in both repos.
  - The inter-repo difference stops being an orphan decision. It has a file, an
    owner, and a date that brings it back to the table — the failure mode that
    ADR-0068 was born to prevent.
  - ADR-0050 stops dangling. The session handoff work has an audience with a
    name, not just "remains in use" with no screen pointing at it.
  - The "what is managed" axis can be applied to screens that do not exist yet.
    The "audience" axis cannot: it demands a list of job titles, and a list of
    job titles goes stale every time a role is added.
- **Negative / accepted trade-offs:**
  - **One capability can now have two screens** — one for the USER in
    `awcms-astro`, one for its management here. That is a real cost, and §4 is
    what makes it deliberate rather than invisible.
  - **The "SYSTEM versus USER" boundary is a judgement, not a gate.** There is no
    test that can decide which of the two a screen belongs to; only its
    permission can be gated. That is why §6 gives it a review date instead of
    pretending it is machine-guarded.
  - Part of ADR-0051's motivation ("one shell, one session, one CSP posture")
    applies to the SYSTEM surface only. A site that turns on `permukaanAdmin`
    carries its own session and CSRF over there — a cost that `awcms-astro`
    ADR-0034 states explicitly so it is chosen, not inherited.
- **Neutral:**
  - **Zero changes to running code in this repo.** This is a governance
    decision; every technical gate stays intact, and not a single permission
    moves.
  - `awcms`'s own public surface (`/blog/{tenantCode}/**`, the host-resolved
    `/news/**` family, `robots`/`sitemap`/`feed`, `/search`) is untouched —
    ADR-0059/ADR-0061 continue to hold as they are.
    A site may be served from here, from `awcms-astro`, or from both; what this
    ADR decides is where the SCREENS are built.

## Alternatives considered

- **Superseding ADR-0051** — rejected. Its core decision holds in full, and
  superseding it would revoke the three replacement gates in its §Decision along
  with that decision. Those gates are precisely the part we most want to keep;
  revoking them in order to widen one exception is a price that is not worth
  anything.
- **Letting this difference live as a reading** of ADR-0051 §Decision — its
  opening sentence versus the paragraph "What is revoked is only its role as the
  home of internal admin screens" — rejected. A rule that can only be seen by comparing two paragraphs will be
  read as a conflict by the next person, and the next person will pick the more
  emphatic paragraph. What is most likely to happen is not a violation, but
  **the rejection of legitimate work** by a genuinely compliant reader.
- **Recording the divergence without an ADR** — mechanically impossible, and
  that is deliberate: `scripts/family-conformance-check.ts` demands that the ADR
  file an entry references actually exists, so a difference cannot be recorded
  without a fully written reason.
- **Moving the USER admin surface here too** (e.g. `/admin/tulis`) — rejected.
  It would demand that every author on every derived site have a session in
  `awcms` and navigate the platform admin shell to write one article, while
  everything they are doing belongs entirely to their own site. That moves
  people, not risk — and the risk is already held back by the authorization
  gate, not by the repo address.
- **Allowing a USER admin surface without a declaration on that side**, relying
  on review — rejected there, and this repo agrees: the failure mode is a green
  build with an authenticated surface nobody ever decided on.
- **Restating that `awcms-mini`/`awcms-micro` are discontinued via a third ADR**
  — rejected. [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md)
  froze them and [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  §1 closed the outbound port path; both are final and disputed by nobody.
  What is left is not the decision but **its application** in the files that
  have not caught up yet — and that is editing work, not deciding work. A third
  ADR repeating the same decision would only make the next reader think there
  are three different rules.
