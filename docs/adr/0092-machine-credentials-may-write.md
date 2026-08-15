🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0092-machine-credentials-may-write.id.md)

# ADR-0092 — Machine credentials may WRITE, and their ceiling stays in code

- **Status:** Accepted (2026-08-13).
- **Context:** Issue #423 Wave 8 PR 8.5 — the last PR of this programme.
  Migration `sql/121`.
- **Builds on:**
  [ADR-0049](0049-machine-credentials-and-session-introspection.md) (machine
  credentials, and the sentence holding everything up: one value in
  `MACHINE_CREDENTIAL_ALLOWED_ACTIONS`), and
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) (the same shape
  once more: the ceiling in code, the narrowing in the row).

## Decision

A machine credential may write, and the actions it may write are

```
MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS  ∩  allowed_write_actions
```

**That order is not a matter of style.** If the action list becomes a PURE
column, one backup restore, one hand-written INSERT, or one provisioning path
that loses its `WHERE` could mint a write credential spanning the whole catalogue
— **with every gate in this repo green**, because not a single gate reads row
contents.

The ceiling therefore lives where it changes only through a reviewed commit. The
column is not the source of truth; it is a narrowing list.

## What is in the ceiling, and the rule that keeps it honest

`create` and `update`. Nothing destructive, nothing that confers authority,
nothing irreversible.

And that property is **computed, not asserted**:

```
MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS ∩ HIGH_RISK_ACTIONS = ∅
```

tested against the **live constants**. A literal list of "the high-risk ones"
would drift the day someone adds a new high-risk action, and drift **silently**.
Deriving it cannot.

Adding a member to the ceiling is an ADR, for the same reason ADR-0049 gave for
the read set: every addition is a new class of thing a stolen token can do, and
it is **invisible in the diff of the endpoint** that suddenly accepts it.

## The absence of an IP is a DENY, and that is the easiest part to forget

A write credential must be CIDR-bound — a database CHECK, not a convention. The
subtler rule lives in the gate: **if `clientIp` is unavailable, the write
credential is denied.**

Without it, every route that has not yet forwarded the caller's address
**silently disables its condition** — a control that reads as enforced and is
not, a class that has already surfaced twice in this wave. Failing closed makes
such a route answer 403, which is a bug report rather than a breach.

`defineTenantRoute` fills it in for every route it owns, on **both** of its paths
— including SSE, where it is resolved once when the stream opens because one long
connection has one peer.

Its CIDR parser is written without dependencies and **narrows when in doubt**: a
CIDR that cannot be parsed matches nothing, rather than matching everything. That
direction is a decision, and it is tested.

## Thirty days, not three hundred and sixty-five

A read credential may live for a year (ADR-0049 §5). A write credential may not:
it can change data, and the time until someone notices it leaked is measured in
weeks.

Its database CHECK is 31 days, one day looser, because `created_at` DEFAULT
`now()` is the **transaction start** instant while `expires_at` is computed from
the application clock — the same trap `sql/117` documents.

## Two sentinels, and the old one VERBATIM

`machine_credential_readonly` exists in decision log history and in ADR-0049.
Recycling it for a write denial would **rewrite the past** for every log consumer
— an old row would start meaning something other than what it meant when it was
written.

The write class gets a new sentinel, `machine_credential_write_forbidden`.

## Consequences

- Every credential existing before this migration **stays read-only**:
  `allowed_write_actions` is empty, and the first branch of every CHECK and every
  predicate is true for an empty row. No backfill, no validation that can fail at
  migration time.
- The gate is **deny-only** and sits in the same place as the earlier read-only
  gate: above `fetchGrantedPermissionKeys`, where no grant row can influence it
  (cross-wave rule 1).
- There is no issuance surface for the write class in this PR. The column exists,
  the gate enforces it, and what could write it does not exist yet — just like
  every PR in this wave that landed inert ahead of its surface.

## Rejected

- **The action list as a pure column**, with no ceiling in code.
- **A literal list of "high-risk actions"** in the test, instead of deriving it
  from the live constants.
- **A fail-open IP condition** when the caller's address is unknown.
- **A CIDR parser that widens when in doubt.**
- **Recycling the `machine_credential_readonly` sentinel.**
- **A one-year lifetime for write credentials.**
