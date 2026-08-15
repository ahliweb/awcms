🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0056-media-library-admin-surface.id.md)

# ADR-0056 — The `media_library` admin surface: revoke what is dead, give a surface to what is needed

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision maker:** @ahliweb
- **Related:** [ADR-0036](0036-media-library-module-admission-ownership-inversion.md) (media ownership inversion), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (all admin screens are built here), [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) (precedent for revoking a permission a tenant should not hold)

## Context

[ADR-0051](0051-admin-screens-consolidated-in-awcms.md) left `media_library` as
one of two modules without a screen. It was listed alongside other modules that
really were only missing a page — and the second screen-wave audit (PR
#335–#338, #340) found that for this module that sentence is **wrong**.

Three findings, all verified against the code, not inferred from documents.

### 1. Five of eleven permissions are gated by nothing

`media_library` declares 11 permissions, and `sql/052` seeds all of them into
the global catalogue. Six have a real `authorizeInTransaction` call site:
`media.create`, `media.read`, `media.verify`, `media.cancel`,
`enforcement.read`, `enforcement.enable`.

**Five have none at all:** `media.attach`, `media.detach`, `media.delete`,
`media.restore`, `media.purge`. No route, no application function, no job
enforces them. They exist in the catalogue and are granted to every new
tenant's `owner` role, and not a single code path checks them.

> A note on how to check this, because it is easy to get wrong:
> `media-object-directory.ts` contains many `action: "news_media.object.attached"`
> strings and the like. Those are **audit action names**, not permission gates.
> Conversely `media.verify` does NOT appear in any route file — its gate lives
> inside the application function `media-finalize-upload-session.ts`. Scanning
> routes alone gives the wrong answer in both directions.

### 2. Five application functions with zero callers

`attachNewsMediaObject`, `detachNewsMediaObject`, `softDeleteNewsMediaObject`,
`restoreNewsMediaObject`, and `purgeNewsMediaObject` are exported from
`application/media-object-directory.ts` and are **called from nowhere** — not in
`src/`, not in `scripts/`, not in `tests/`. The only remaining reference to
`purgeNewsMediaObject` is a comment.

The lifecycle that actually runs today is performed by the reconciliation job
through DIFFERENT functions — `purgeExpiredPendingNewsMediaObject` and
`markStaleOrphanedNewsMediaObjectDeleted` — on its own schedule.

### 3. There is no list function

`GET /api/v1/media/objects` demands `?ids=` (maximum 100) — it is a **batch
resolver**, built for `awcms-astro` to swap ids for URLs at build time, not a
list. The application layer only has `fetchNewsMediaObjectById`,
`fetchNewsMediaObjectsByIds`, and `fetchNewsMediaObjectByObjectKey`. There is no
`list*` at all.

That means a browse screen **cannot** be built on the existing surface: it needs
a new read function. "The screen is missing" is therefore not an honest
description for this module, and listing it alongside the six modules that
really were only missing a page made it look like one PR's work for two waves.

## Decision

The `media_library` admin surface is **not** built as a single screen on top of
the existing permissions. It is split three ways, because those five ungated
permissions are not in the same class.

### A. `media.attach` / `media.detach` — REVOKED

Both have been obsolete since
[ADR-0036](0036-media-library-module-admission-ownership-inversion.md). Before
the inversion, `news_media` owned the object→content relation, so
"attach"/"detach" were real actions on this module. After the inversion, media
attachment is expressed by a **FK owned by the consumer** — `featuredMediaId` on
a `blog_content` post, `media_object_id` on an ad placement. Changing it means
updating the consumer's row, gated by the consumer's permission.

Leaving both in the catalogue means every tenant owner holds authority over an
action nobody can perform, and the next permission review has to guess again
whether that is a gap or a leftover. Revoked via a new migration, following the
[ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) precedent
(`sql/084`).

**Correction to the first edition of this ADR.** The original sentence read "the
five dead functions are deleted along with them" — that contradicts §B, which
actually USES three of those five functions. What is deleted is **two**:
`attachNewsMediaObject` and `detachNewsMediaObject`. `softDeleteNewsMediaObject`,
`restoreNewsMediaObject`, and `purgeNewsMediaObject` stay — §B gives them
endpoints.

The `attached` status itself is **not** revoked along with them: the CHECK in
`sql/041` still accepts it and `isNewsMediaObjectSafeForPublicReference` still
considers it safe, so rows already in that status still resolve. What is lost is
the ability to write it from this module — which nobody used anyway.

### B. `media.delete` / `media.restore` / `media.purge` — GIVEN A SURFACE

These three are not leftovers; they are holes. An object uploaded by mistake,
orphaned, or in breach of policy can today **only** disappear if the
reconciliation job happens to categorize it that way, on its own schedule. There
is no way for an administrator to delete a single object, and no way to undo it
if that was a mistake.

All three get a guarded, audited endpoint carrying an `Idempotency-Key`, and the
application functions already written for them are used — not deleted.

**`purge` deletes the registry row, not the R2 object.** The reconciliation job
owns the R2 deletion path, and duplicating it in an endpoint means two writers on
one bucket with two different ideas about what is safe to delete. The endpoint
purifies the registry; the job stays the owner of the bytes. An accepted and
stated cost: a window in which the R2 object outlives its registry row, closed by
the next reconciliation tick.

### C. Object listing — a NEW read function, not a widened resolver

`listMediaObjects(tx, tenantId, filter, cursor)` is added to
`application/media-object-directory.ts`, with status/MIME filters and a **keyset
cursor** (`(created_at, id)`, microsecond-precision text — a trap already
recorded in this repo).

`GET /api/v1/media/objects` is **not** extended into a dual-mode endpoint. `?ids=`
is a contract `awcms-astro` already uses on its build path; adding a "no `ids`
means list everything" branch to the same endpoint turns a request that is a 400
today into a dump of the entire registry. The list gets its own route.

The `/admin/media` screen follows once A–C have landed, and it only drives gated
permissions.

## Consequences

- **A real authorization change.** Two permissions are revoked from the
  catalogue. A tenant that granted them to a custom role loses that grant; no
  behaviour changes, because nothing ever checked them.
- **Three new endpoints** add write surface to a module that has so far been
  almost entirely reads + jobs. All three are `isHighRiskAction`-worthy: `purge`
  cannot be undone.
- **The order is binding.** A and B change the permission catalogue; both must
  land before any screen gates anything on top of them — exactly the class of
  defect `tests/admin-*-page-contract.test.ts` has already caught twice.
- **`media_library` stays without a screen until C is done**, and
  `docs/PROJECT_STATE.md` §4 must name it as ADR-carrying work, not as one
  screen left behind.

## Rejected alternatives

- **Build a screen on top of the six gated permissions only, and leave the other
  five.** This is the fastest, and it leaves five seeded permissions that nobody
  checks in a catalogue granted to every owner. This repo has already shipped
  latent-authz defects twice; five idle permissions are the raw material.
- **Revoke all five.** Tidy, and wrong: `delete`/`restore`/`purge` describe
  actions operators genuinely need and today do not have. Revoking them turns a
  hole into a decision without anybody deciding.
- **Give all five a surface.** That means building attach/detach that write an
  attachment this module does not own — exactly the ownership ADR-0036 inverted.
- **Extend `GET /api/v1/media/objects` into dual mode.** Rejected in §C: turning
  today's 400 into a registry dump is a contract change disguised as an addition.
