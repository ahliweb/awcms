🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0058-unenforced-permissions-disposition.id.md)

# ADR-0058 — Four declared permissions with no enforcer: two surfaces, two revocations

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision maker:** @ahliweb
- **Related:** [ADR-0057](0057-blog-page-lifecycle.md) (§F builds the gate that found all four), [ADR-0056](0056-media-library-admin-surface.md) (precedent: revoke what is obsolete, give a surface to what is a real hole), [ADR-0041](0041-comments-module-admission.md) (the `comments` moderation model), [ADR-0036](0036-media-library-module-admission-ownership-inversion.md) (precedent for revocation via migration)

## Context

[ADR-0057](0057-blog-page-lifecycle.md) §F added
`bun run access:permissions:enforcement:check`: every permission a descriptor
declares must have an `authorizeInTransaction` call site in `src/`, or a written
reason why it does not. That gate exists because two modules had already shipped
seeded permissions that nothing ever checked, and both were only discovered
months later — on `blog_content` the consequence was that a page **could never
be published at all**.

### 1. Its first score carried two false accusations, and that is part of the context

The first run reported **199/205 with 6 exceptions**. Two of them —
`visitor_analytics.settings.read` and `.update` — were **correctly gated**;
`src/pages/api/v1/analytics/settings.ts` builds `READ_GUARD`/`UPDATE_GUARD`
on exactly those activities. The scanner was the thing that was wrong: it
resolved every `const NAME = "value"` through a single flat table across the
whole repo, and `MODULE_KEY` is bound in five files to four different values, so
the "conflicting name = unresolvable" rule killed it in every file — including
the file that binds it one line above its guard.

What is worth recording as context for this decision is not the bug but its
consequence: both accusations were **written straight in as reasoned DECISIONS**
in the `EXCEPTIONS` list, with a reason that claimed about existing routes that
"no route names a settings activity", and then copied into
`docs/PROJECT_STATE.md` as backlog. Fixed in PR #359 (file-first constant
resolution, mutation-proven at two layers); the score is now **201/205 with
4 exceptions**.

The consequence for this ADR: **every single one of the four remaining below was
re-verified against the code**, in the route directories and not only inside its
module, before being written down as a decision.

### 2. The remaining four fall into two different classes, not one

The exception list treats all four as a single class ("permission with no
enforcer"). Checking the code refutes that — two of them have their entire
machinery except the surface, the other two have no machinery at all:

| Permission                                    | Domain/application machinery                                                    | Surface | Class     |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ------- | --------- |
| `profile_identity.profile_management.restore` | `deleted_at`/`restored_at`/`restored_by` columns (`sql/003`), `softDeleteParty` | none    | hole      |
| `comments.moderation.delete`                  | the `delete`→`deleted` transition in `applyModerationAction`, queue filter      | none    | hole      |
| `blog_content.seo.configure`                  | none — the data is managed by ANOTHER permission                                | none    | duplicate |
| `blog_content.posts.export`                   | none, anywhere                                                                  | none    | obsolete  |

#### `profile_identity.profile_management.restore` — soft delete with no way back

`sql/003` gives `awcms_profiles` five lifecycle columns: `deleted_at`,
`deleted_by`, `delete_reason`, `restored_at`, `restored_by`, plus the index
`awcms_profiles_tenant_deleted_idx` built precisely to filter on that axis.
`party-directory.ts` exports `createParty`,
`fetchPartyById`, `listParties`, `updateParty`, and **`softDeleteParty`** —
with no counterpart.

The five profile routes (`/api/v1/profiles`, `/{id}`, `/{id}/identifiers`,
`/{id}/links`, `/resolve`) gate `read`/`create`/`update`/`delete`.
There is no restore route. So `restored_at`/`restored_by` **can never be
filled through the API**, and a soft-deleted profile is effectively permanent:
its row exists, its index exists, its restoration columns exist, and there is no
code path that can write to them. Exactly the shape ADR-0056 §B closed for media
objects.

> **Correction to the first edition of this ADR.** The paragraph here originally
> accused `profile-identity/README.md` of stating that its routes gate
> `read`/`create`/`update`/**`merge`**. That is **wrong**, and wrong in a way
> worth recording: the README is correct (`{read,create,update,delete}`) —
> the "merge" phrasing lives in the **gate's exception reason text**, written on
> its first run and already corrected in PR #359. I quoted a gate's note and
> then attributed it to the README without opening the README.
>
> What makes it worth keeping rather than quietly deleting: this is the THIRD
> instance of the same pattern within a single stretch of work — wrong text from
> a gate becomes the source for the next document, which then reads as an
> independent finding. Exactly the mechanism that let the two false accusations
> in §1 survive. The rule: **quote the file, not a note about the file.**

#### `comments.moderation.delete` — the half that landed is the author's half

This is the case that is easiest to misread, so the order of the evidence
matters.

The `deleted` status **is reachable today** — but only by the comment's AUTHOR:
`requestCommentDeletion` writes `SET status = 'deleted'` when the request arrives
inside the edit window, then records a moderation-event row with `actor_kind`
`'author'`. That path is authenticated by the author binding (user id / IP hash),
not by a permission.

The moderator side never landed, even though the entire machinery is there:

- `applyModerationAction` accepts `"delete"` and transitions it to `deleted`;
- `LEGAL_TRANSITIONS` allows it from **all four** non-terminal statuses;
- `QUEUE_STATUSES` contains `deleted`, so the admin queue can filter on it —
  a moderator can SEE deleted comments while never being able to delete a single one;
- the module descriptor (`module.ts` §retention) says so explicitly: "Soft delete
  (`status='deleted'`) is a separate **moderator**/author action, also
  non-destructive";
- the `comment-moderation.ts` header claims to implement
  "approve/reject/spam/archive/restore/**delete** transitions (single + bulk)".

The four existing moderation routes gate `read`, `approve`/`reject` (conditional
guard), `archive`, and `restore`. Not one of them forwards
`"delete"`.

That header claim — a document describing a surface that never existed — is the
same lesson `docs/PROJECT_STATE.md` §4 records for the `reporting` and
`workflow-approval` READMEs, and it also explains why this defect passed review:
whoever read it saw a confirmation, not a question.

What is LEFT for a moderator today is all reversible and all keeps the comment
body in the queue: `reject`, `spam`, `archive`. There is no action that pulls a
comment out of circulation **one-way** — while its author has exactly that.

#### `blog_content.seo.configure` — a second axis for data that is already managed

`sql/036` seeds `('blog_content', 'seo', 'configure', …)` and the descriptor
declares it as "Configure blog SEO metadata defaults". The only occurrence of
`activityCode: "seo"` in the entire repo is that declaration itself.

And the defaults it promises **are already managed** — by another permission:
`blog-settings-policy.ts` carries `seoDefaultTitle` and
`seoDefaultDescription` as `awcms_blog_settings` fields, written through
`PATCH /api/v1/blog/settings` under `blog_content.settings.configure`.

So this row is not a hole: it is a SECOND authorization axis for data that
already has one. Keeping it means two different permissions promise authority
over the same columns, and only one of them is ever asked.

#### `blog_content.posts.export` — a promise with no machinery

`sql/036` seeds `('blog_content', 'posts', 'export', 'Export blog posts')`.
No route, no application function, no serializer, no job,
no column — zero export machinery in this module or anywhere else in the repo.
Unlike the three above, there is nothing half-built to finish.

### 3. Why all four matter even though none is exploitable

`POST /api/v1/setup/initialize` grants the **entire catalogue** to the `owner`
role of every new tenant. So every tenant owner holds authority over four actions
that no code path checks. That cannot be exploited today —
nothing reads them — and that is precisely the problem: it is exactly the
ambiguity that forces the NEXT permission review to guess whether an unused row
is a gap or a leftover. ADR-0052/`sql/084` and ADR-0056 §A/`sql/087`
both close the same shape.

## Decision

### A. `profile_identity.profile_management.restore` gets a surface

`POST /api/v1/profiles/{id}/restore` — guarded by `profile_management.restore`,
requiring an `Idempotency-Key`, audited, inside a single `withTenant`.
`restoreParty` becomes the counterpart of `softDeleteParty` and writes
`deleted_at = NULL`, `restored_at`, `restored_by` in a single `UPDATE`.

**The precondition is enforced in the WHERE, not read first**, following
`canRestorePost`: `WHERE tenant_id = … AND id = … AND deleted_at IS NOT NULL`,
and zero rows affected → 404. Reading first and then writing opens a race that
produces two "restored" audit rows for one restoration.

**There is no `23505` trap here, and that was verified rather than assumed.**
The right reflex for a restore is to suspect a partial unique:
`sql/003` does install `awcms_profile_identifiers_dedup_key … WHERE
deleted_at IS NULL`, and restoring a row underneath an index like that is a
classic source of `23505`. But that index is on
**`awcms_profile_identifiers`**, whereas `awcms_profiles` **has no unique
constraint at all** — and `softDeleteParty` touches **one table only**, it does
not cascade to identifiers. The identifiers of a soft-deleted profile therefore
stay alive (`deleted_at IS NULL`) while that profile is deleted.

So the restore is exactly symmetric with the delete: one `UPDATE` on one table,
with no `23505` path. A consequence recorded so it is not rediscovered as a
surprise: soft-deleting a profile does **not** release its identifiers' dedup
key, so while the profile is deleted, the same identifier cannot be used by
another profile. That is today's behaviour, unchanged by this ADR, and it is
precisely what makes the restore collision-free.

### B. `comments.moderation.delete` gets a surface, and its ONE-WAY nature is part of the decision

`POST /api/v1/comments/admin/{id}/delete` — guarded by `moderation.delete`,
requiring an `Idempotency-Key`, audited, forwarding `"delete"` to the existing
`moderateComment`. Zero changes to the state machine: the transition is
already legal from all four non-terminal statuses.

What does NOT change, deliberately: **`deleted` stays terminal.**
`LEGAL_TRANSITIONS.deleted` stays `[]`, and its comment ("recovering a deleted
comment is an operator/database action, deliberately not an in-band moderator
move") still holds. So this ADR gives moderators the only
irreversible action in that module — and that is accepted knowingly for three
reasons:

1. the state is **already reachable today** through the author path, so this
   decision introduces neither a new state nor a new terminal property — it only
   stops making the author the only actor who can reach it;
2. it remains **non-destructive**: the row, the body, and the moderation history
   survive (ADR-0041's archive-don't-delete is not violated — what is deleted is
   visibility, not data);
3. everything left without it is reversible and all of it keeps the comment body
   in the queue, so a moderator facing content that must be permanently pulled
   has no in-band answer at all.

`bulk-moderate.ts` does **not** also accept `delete`: bulk today is only
approve/reject, and an irreversible action is the last action that deserves a
mass button.

### C. `blog_content.seo.configure` is revoked

Revoked from the catalogue and from every role grant. `settings.configure` is
already the answer, and keeping two axes for one column only defers the same
question to the next review. **No** change to
`seoDefaultTitle`/`seoDefaultDescription`, to `PUT /api/v1/blog/settings`,
or to the `seo_distribution` renderer: all that disappears is a catalogue row that
was never asked about.

### D. `blog_content.posts.export` is revoked

Building an export feature to justify a catalogue row is the tail wagging the
dog — a sentence already written in its exception reason
since ADR-0057 §F. If post export is genuinely needed one day, it arrives
with its own ADR, its own permission, and its machinery — not with a
row three years older that just happens to already exist.

### E. One migration for both revocations

One new migration — the next free number in `sql/` when it lands; this ADR
deliberately does not write it down, because `check:docs` rejects an `sql/NNN`
token whose file does not exist yet, and a number reserved in a document is a
number that can be wrong when another PR lands first. Its shape follows `sql/087`
exactly: grants first (`awcms_role_permissions`
references `awcms_permissions`, so the reverse order hits the FK), then the
catalogue rows; both are unconditional natural-key deletes so they are idempotent;
with no rollback statement, because restoring them would mean re-advertising a
surface this ADR declares does not exist.

Both revocations are combined into ONE migration because they are the same
decision on the same module, and splitting them into two numbers only adds two
rows to the migration table without adding a single unit of reviewability.

### F. Revocation follows the surface, not the other way round

The PR order is binding: the two surfaces first, the revocation migration last.
The reason is not aesthetic — `access:permissions:enforcement:check` marks an
exception whose permission **already has an enforcer** as **stale** and reddens
CI. So every surface PR must delete its exception entry
in the SAME PR, and the revocation PR deletes the last two entries together with
its migration. Once all four land, the `EXCEPTIONS` list is **empty** and
the score is `203/203` — a number the gate itself computes, not one written
by hand here.

## Consequences

- **Two new surfaces, zero schema changes.** §A and §B both write columns that
  already exist and use permissions that are already seeded; no new table,
  column, CHECK, or index.
- **Two permissions disappear from every tenant.** Owners who today "have"
  `blog_content.seo.configure` and `posts.export` stop having them. No
  behaviour changes — no code path ever asked about them.
- **`awcms_permissions` drops from 205 to 203 rows.** Tests and documents that
  carry that number change in the same PR.
- **One new irreversible moderator action**, stated explicitly in §B
  and bounded: single only, not bulk.
- **No backfill needed.** This is a revocation, not an addition — and this is
  precisely the direction with no old-tenant trap: a `DELETE` by natural key
  hits every tenant at once, whereas a new permission seed only
  reaches tenants born afterwards (see
  `identity-access:permissions:backfill`).
- **The gate's exception list becomes empty.** Its value: the NEXT
  exception will be the only entry in that list, so it cannot
  hide in the middle of an already long list.

## Rejected alternatives

- **Revoke all four.** Rejecting §A means blessing as design a
  soft delete with no way back, with three columns in `sql/003` that exist
  precisely to bring it back. This is the same reason ADR-0057 §A rejected for
  `pages.publish`: revoking a permission whose defect is exactly "nothing calls
  it" turns a bug into a specification.
- **Give all four a surface.** It demands building post export that nobody
  asked for, and a second SEO axis that collides with
  `settings.configure`. A catalogue row is not a requirement.
- **One ADR per permission (as each exception reason says).** Four
  ADRs for one and the same class of defect, three of them a few paragraphs long.
  ADR-0056 already decided five `media_library` permissions in a single document
  with §A/§B/§C, and that is exactly what made the contrast — revoke vs give a
  surface — readable as one decision.
- **Give `delete` to `bulk-moderate.ts` while we're at it.** A tempting and
  wrong symmetry: bulk changes the cost of a single mistake from one comment to an
  entire queue page, and this action is one-way.
- **Make `deleted` recoverable so §B does not add a terminal action.**
  A change to a state machine that the author path already uses, in an ADR that
  is not discussing the moderation model. If the terminality of `deleted` is
  later judged wrong, that is a revision of ADR-0041 with its own context.
