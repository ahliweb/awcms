🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0091-two-sided-attribution.id.md)

# ADR-0091 — Two-sided attribution, and the birth certificate that can finally be written

- **Status:** Accepted (2026-08-13).
- **Context:** Issue #423 Wave 8 PR 8.3. Migration `sql/118`.
- **Builds on:**
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) (a delegated
  actor is a real tenant user — which makes every record about them look like a
  record about an employee),
  [ADR-0054](0054-tenant-provisioning.md) (an open follow-up that is closed
  here), and [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (the decision log is
  the largest table in this repo — anything added to it has to
  pay its rent).

## The problem ADR-0090 created

The ADR-0090 decision that made everything work with no changes — **a delegated
actor is a real tenant user** — also made one thing stop working: its records
cannot be told apart.

`actor_tenant_user_id` on an audit row points at a perfectly ordinary membership
row in tenant C. Nothing on it says the person behind it works for tenant X. The
question **"what has our vendor done inside our system"** therefore has no query
— every one of its rows looks like an employee row.

## Decision

Three columns, and each answers one question:

| Column                                        | Answers                                   |
| --------------------------------------------- | ----------------------------------------- |
| `awcms_audit_events.actor_tenant_id`          | which tenant the actor is from            |
| `awcms_audit_events.delegated_grant_id`       | which grant made it possible              |
| `awcms_abac_decision_logs.delegated_grant_id` | the same, on every authorization decision |

## NULL means "from inside", not "unknown"

`actor_tenant_id` is **not** written on every row. Writing it would duplicate
`tenant_id` on 99.9% of rows, and a column that is nearly always the same as its
neighbour stops being read — which is exactly when the one row where it differs
goes past unseen.

The shape is not a new invention: `awcms_tenant_status_transitions.actor_tenant_id`
(`sql/092`) has used it since ADR-0054. This PR uses the shape that already exists
instead of creating a second one.

A stated consequence: **no backfill.** The existing rows were written before
delegated access existed, so NULL on all of them is already correct. Filling them
with `tenant_id` would turn every old row into a claim that happens to be true and
would erase the distinction that is this column's entire purpose.

## The FK is composite, and that is not style

`(tenant_id, delegated_grant_id)` → `awcms_delegated_access_grants
(tenant_id, id)`. A simple FK on `id` alone **bypasses RLS**, like every FK, and
would accept another tenant's grant id — an audit row naming a grant that never
reached this tenant. The same demand produced the composite office FK in #149.

Its paired CHECK closes the half-answer: a row must not name a grant without
naming the tenant it came from.

## The decision log does NOT get `actor_tenant_id`

It only gets `delegated_grant_id`, and that saving is deliberate.

Decision log rows are written by the chokepoint on the hot path of **every
request** — the largest table in this repo (ADR-0072). The originating tenant can
be derived from its grant through one join that only an investigation runs. Storing
both means writing two columns per request to avoid one join that is run a few
times a year.

The same reason makes its index **partial**: the column is NULL on nearly every
row, and a full index over it is cost with no reader.

## The grant is resolved with a SECOND query, not a join

`resolveDelegatedGrantId` runs only when `principal_kind = 'delegated'`.

Joining the grant table into the authentication query would make **every ordinary
request** pay an index probe so that the rare request could save one round trip.
The cost would land in the wrong place.

The resolution is also **fail-quiet**, and that is safe precisely because of the
column's nature: the grant id is **attribution, not authorization input**. Nothing
is allowed or denied because of it, so what is lost when it is not found is one
column on an audit row — never a decision.

## The birth certificate that can finally be written

ADR-0054 left one open follow-up:

> provisioning audit rows land in the platform tenant's log, which is correct, but
> **the created tenant does not see its own birth certificate.**

It stayed open because it **looked impossible**, and it looked impossible for the
right reason: `awcms_audit_events` is FORCE RLS, so the platform tenant cannot
insert a row bearing another tenant's `tenant_id`. The same wall brought down the
ADR-0087 and ADR-0088 plans.

What makes it possible here is something that already existed and that nobody
noticed: `createTenantWithOwner` **already stands inside the new tenant's
context** — it does `SET LOCAL app.current_tenant_id` at the start and restores it
at the end. Its birth certificate is written from INSIDE, in a window that already
exists, without a single cross-tenant write.

That is also why this finding goes into an ADR instead of becoming a quiet commit:
three PRs in a row concluded "cannot be done" from a correct premise, and what
makes this case different is not a new rule but **where the code happens to
stand**. The next person who reads "cannot write across tenants" must read this
sentence too.

**`actor_tenant_user_id` deliberately does not cross over.** `actor_tenant_id`
gives the customer the fact they need — this tenant was created by the platform.
The individual operator's id is an opaque uuid they cannot resolve (RLS stops them
reading the platform's `awcms_tenant_users`) while still being an identifier handed
to a third party. It stays on the platform-side row, where it can be resolved.

## Consequences

- The question "what have outsiders done in my tenant" becomes one indexed query
  over `awcms_audit_events (tenant_id, actor_tenant_id, created_at DESC)`.
- The question "what has happened under this grant" becomes one query, and it
  reaches **both** tables — the actions and every authorization decision that
  preceded them.
- A newly created tenant now has exactly one `create` audit row in its own log,
  bearing the platform's `actor_tenant_id`. The ADR-0054 follow-up is **closed**.
- These columns land **inert for every deployment not yet using delegated
  access**: NULL everywhere, no behaviour changed, and one new row at provisioning
  time.

## Rejected

- **Backfilling `actor_tenant_id = tenant_id`** for old rows.
- **`actor_tenant_id` on the decision log** — two columns per request to avoid one
  investigative join.
- **A full index** over a column that is nearly always NULL.
- **Joining the grant table into the authentication query** — a cost on every
  ordinary request for the sake of the rare one.
- **Carrying the platform's `actor_tenant_user_id` into the customer's log.**
- **Making the grant id an authorization input.** It is attribution; making a
  decision depend on it would turn a harmless resolution failure into an access
  failure.
