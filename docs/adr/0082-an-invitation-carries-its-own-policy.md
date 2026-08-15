🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0082-an-invitation-carries-its-own-policy.id.md)

# ADR-0082 — An invitation carries its own Policy

- **Status:** Accepted (2026-08-11).
- **Context:** Issue #423 Wave 4 PR 4.1. Migrations `sql/106` (schema) and
  `sql/107` (permissions).
- **Builds on:**
  [ADR-0078](0078-a-grant-carries-its-own-scope.md) (the Policy shape),
  [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md) (one
  grant source), [ADR-0080](0080-a-scoped-grant-covers-only-what-its-role-confers.md)
  (the limit of scope qualification — quoted below and **answered by not
  producing it**), and [ADR-0081](0081-a-user-group-is-a-subject-that-grants-roles.md)
  (separating membership authority from role granting).

## Decision

`awcms_invitations` + `awcms_invitation_policies`. An invitation names an
address, and carries the list of roles that person will hold as soon as they
accept. Acceptance (PR 4.2) grants those roles through the existing grant writer
— not through a second path.

Self-registration **stays**. The direction is the opposite: registration is
_pull_ (a stranger asks), an invitation is _push_ (an admin offers). Each
has its own permission and its own audit story.

## Inviting and GRANTING A ROLE are two authorities

This repeats ADR-0081 §"Why giving a group a ROLE uses
`access_control.assign`", and the repetition is deliberate because invitations
make the stakes worse.

`invitations.create` decides **who may be brought in**.
`access_control.assign` — which already exists and already means "handing out
roles" — is what decides **which roles it carries**. An invitation with roles
demands BOTH; an invitation without roles demands only the first.

Merging them would produce exactly the group escalation, only
worse on one axis: a grant to a group reaches people who join later, whereas a
grant through an invitation reaches a person who **does not exist yet** —
there is no row to review, no name to recognise, and the recipient chooses for
themselves when that grant comes alive.

That is why the `is_system` refusal is checked **twice**: when the invitation is
created and again when it is accepted. The precedent is
`approveRegistrationRequest`, and the reason for the second check is the time
gap — a role can become `is_system`, be soft-deleted, or be removed from the
catalogue between those two moments.

## An invitation carries its scope columns, PINNED tenant-wide — and that is the answer to ADR-0080

ADR-0080 closes itself with an explicit limit: scope qualification is only as
strong as the routes that **declare** a required scope, because
`fetchGrantedPermissionKeys` still returns keys from every grant — it must,
since the RBAC gate runs first. On a route that declares no scope, a scoped
grant confers that permission **across the whole tenant**. That limit is inert
as long as zero writers of scoped grants exist, and ADR-0080 wrote down that the
PR adding the writer must not land without answering it.

A scoped invitation is that writer. This PR answers it by **refusing to be
that writer**, not by avoiding the columns.

`awcms_invitation_policies` carries `scope_type` and `scope_id`, and a
CHECK pins both:

```sql
CONSTRAINT awcms_invitation_policies_tenant_wide_only_check
  CHECK (scope_type = 'tenant' AND scope_id = tenant_id)
```

The exact precedent is ADR-0078 §"`subject_type` deliberately accepts one
value": a column born with one legal value, so that the next addition is a
single `DROP CONSTRAINT`/`ADD CONSTRAINT` and not a backfill. ADR-0081 harvested
that reward — groups landed without moving a single row.

The option that was rejected, and whose reasoning deserves writing down because
it sounds safer: **dropping the columns entirely**. The argument is that
`grantRolePolicy` hardcodes `('tenant', ${tenantId})` — it has no scope
parameter — so a scope column would be accepted, stored, and then silently
ignored at materialisation time; an admin who invites someone "only for the
Bandung branch" gets a person holding that role across the whole tenant while
the row says otherwise.

That argument is correct for an **unconstrained** column, and the CHECK above
removes it entirely: a value that could lie cannot be represented. What is
stored and what is materialised always agree, because there is only one value
both can hold. A column that cannot lie and saves the next migration is better
than an absent column.

When a scoped grant writer really is built, this CHECK is loosened in the
**same** migration that teaches `grantRolePolicy` to accept a scope — and from
that second on, `SCOPE_NARROWING_ENABLED = false` stops being a safe rollback
(`scope-narrowing.ts` §22-25 writes it down). That is an ADR of its own.

## `skip_email_confirmation` is gated, not merely recorded

This column erases the only evidence that the person on the other end really
holds their mailbox. The programme plan locks its use to a permission with
`scope: 'platform'`, or to a target principal that is already verified.

The global principal does not exist yet (Wave 7), so the second half is
re-derived for today's world: **an active identity that already exists in this
tenant** with the same `login_identifier` has already proved control of its
mailbox — inviting it again (new roles, the same membership) does not demand a
second proof.

Beyond that it demands `identity_access.invitations.configure`, this module's
only permission with `scope: 'platform'` — denied by the chokepoint unless the
acting tenant is the platform tenant ([ADR-0053](0053-platform-scoped-permissions.md)).

Without that gate, any tenant admin could mint an unverified account for
anyone's address. Today that account is confined to its tenant; after
Wave 7 it is a **global principal**, and `materializeMembership()` —
introduced in PR 4.2 as a single function precisely so Wave 7 has one
place to redirect — is what will mint it. The gate lands
now, together with the column, because a widening only lands after the narrowing
that bounds it (cross-wave rule §6.5).

## Resend ROTATES, and `resend_count` is bounded by the DATABASE

Without rotation, "send again" is a token-multiplication surface: one invitation
grows N live links, and revoking the invitation means revoking N secrets
nobody counted. Resend therefore writes a new `token_hash` on the same row —
the old link dies the same second the new one is born.

`CHECK (resend_count <= 5)` lives in the database, not in TypeScript, for the
same reason `awcms_session_handoff_codes` puts its TTL there: a limit that only
lives in the application layer is a limit that disappears as soon as there is a
second caller.

## Expiry is answered with 404, not 410

`410 Gone` tells the token holder that the token **was once valid**. Invitations
are sent to email addresses, and email addresses leak; a uniform 404 for
unknown, expired, revoked, and already-accepted tokens keeps this surface from
being a status oracle.

This diverges from `POST /auth/password/reset`, which answers
`400 PASSWORD_RESET_INVALID` for the equivalent failure class. Both are right
for their own shape: the reset token arrives in the **body** of a POST, so a
404 would mean "this route does not exist"; the invitation token arrives in the
**path**, so a 404 is exactly the same answer a mistyped URL gets.

## What was REJECTED

1. **Scope columns WITHOUT the CHECK that pins them** — and, in the opposite
   direction, dropping the columns entirely. Both are discussed in §"An
   invitation carries its scope columns" above: the first can lie, the second
   pays for one more migration without buying anything.
2. **`invitations.assign` as a permission of its own** — an invitation with
   roles uses `access_control.assign`, the permission that already means
   "handing out roles". A second permission would create a role granter
   invisible to anyone auditing who may grant roles.
3. **`invitations.resend` as an action of its own** — `resend` is not a member
   of `AccessAction`, and adding it would declare that resending is a different
   authority from issuing. It is not: a resend mints a new secret with exactly
   the same power, so it is gated by `create`.
4. **`delete` for invitations** — `revoke` already answers the question ("this
   link is dead now") while keeping the row as the answer to "who invited whom,
   and what happened". A deleted row and an invitation that never existed cannot
   be told apart.
5. **Storing the raw token so an admin can copy the link** — this repo
   does not store a single live credential outside its one-way hash. An admin
   who needs a new link resends; that already rotates, and its trace is recorded.
6. **Returning the email address in the preview** — its caller is
   unauthenticated. The preview answers the tenant name and the inviter's name;
   the link holder already knows which address was mailed because they read it
   in that mailbox, and the holder of a **stolen** link does not.
7. **`Idempotency-Key` on resend** — replaying a resend means returning a
   token that has already been rotated, or storing a plaintext token in
   `awcms_idempotency_keys`. The precedent is machine credential issuance
   (ADR-0049), which rejected it for exactly the second reason.
8. **A cross-tenant invitation from a single row** — `awcms_invitations` carries
   `tenant_id` with a composite FK like every other authorization table. One
   human invited into three tenants is three invitations, because today they are
   also three identities. Unifying them is Wave 7.

## Consequences

- `awcms_invitations` carries a `dataLifecycle` descriptor (`generic`, a 7-day
  floor) like `awcms_registration_requests`: the rows that get purged are the
  ones whose review is finished, and the floor exists so the
  `invitation_accepted` audit still points at something.
- `awcms_invitation_policies` goes into `BOUNDED_BY_DESIGN` — it is bounded by
  its parent through `ON DELETE CASCADE`, so its parent's retention is its
  retention. This is the **second** use of `CASCADE` in this repo; the reasoning
  is in the `sql/106` header.
- `tests/access-assignment-writers.test.ts` sees a new file: the invitation
  acceptor calls `grantRolePolicy(`, so that file must contain
  `is_system` — and it does, because the second refusal really does live there.
- Three new permissions land without a screen. They go into the
  `NOT_YET_SCREENED` ledger; `/admin/invitations` is a change of its own, the
  same order as ADR-0056 (`media_library` got its API surface first, its screen
  afterwards).
