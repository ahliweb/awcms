---
"awcms": minor
---

fix(media-library,blog-content,docs): two surfaces that answered nobody, and a gate that answered wrongly

PROJECT_STATE §4 **D16**, **D17**, and the `docs:i18n:stamp` item found while
working. The two media findings are opposites: one was a whole branch nothing
could reach, the other a surface that answered with something unusable.

**D16 — the orphan lifecycle is deleted, the schema is kept.**
`markNewsMediaObjectOrphaned` was this repo's only writer of
`status = 'orphaned'` and had zero callers, so the reconciliation job's
stale-orphan sweep, its partial index and the grace-period comparison all gated
a permanently empty set — and every run printed
`staleOrphaned(total=0,deleted=0,deferred=0)`, which reads exactly like a clean
bucket. It is a leftover of the pre-ADR-0036 model: `sql/087` removed the
attach/detach relation, so no reference count exists to derive "orphaned" FROM.

Gone: the writer, `markStaleOrphanedNewsMediaObjectDeleted`, the
`cleanupStaleOrphaned` path (whose docblock reasoned carefully about a race that
could not occur), the `staleOrphaned` category and the job's three counters.

**`NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` is NOT deleted with them.** It looked dead
and is not — `orphanInR2`, an R2 object with no DB row at all, genuinely uses it
to decide when physical deletion is safe. Removing it would have taken out a
live control.

Kept, per the decision to delete the code and not the schema: the `'orphaned'`
value in `sql/041`'s CHECK, `orphaned_at`, its partial index, and both status
filters (the admin screen's and the API's — they are reads over a column that
can still hold the value, and dropping one would leave two surfaces disagreeing).
`isNewsMediaObjectSafeForPublicReference` still refuses the status, so a row that
reached it by hand stays out of public references.

**D17 — an ad row a renderer can actually use.** `GET /api/v1/news-portal/ad-placements`
returned `mediaObjectId` and nothing else, so an external renderer could neither
build an `<img src>` nor reproduce the media-safety filter. Three fields are
added to `AdPlacementItem`, all required: `mediaPublicUrl`, `mediaAltText`, and
`mediaPubliclyReferenceable`.

The last is the point. It is the SERVER's verdict, not a status to interpret:
`isNewsMediaObjectSafeForPublicReference` turns on which lifecycle states count
as verified, and a consumer reimplementing it gets that wrong in the permissive
direction — which publishes an unverified image. `false` also covers a
soft-deleted object, so a consumer checking only this field cannot render one.

Resolved in the same query on every path — a `LEFT JOIN` with the media
predicate in the `ON` clause, so a placement whose object was soft-deleted still
appears in the admin list rather than vanishing from the one screen that could
repair it, and a data-modifying CTE on create/update so a freshly created ad is
not reported as unreferenceable. No N+1, no second endpoint. `/admin/blog-ads`
now says whether the attached image will actually be shown.

**The client asset budget could be measured against a `dist/` the build had not
cleaned, and it was.** `bun run build` now runs `rm -rf dist` first.
`client-asset-budget.ts`'s own docblock already recorded being misled this way
twice; it happened a third time on 22 August 2026, producing a phantom 425 B
"saving" for D12 that sent a whole PR down the wrong road. The claim is
corrected in the D12 changeset and in PROJECT_STATE §4. A gate that documents
its own hazard will mislead somebody again, so the hazard is removed instead.

**`docs:i18n:stamp` no longer declares a mirror current that nobody
re-translated.** Re-writing the marker is a claim about the translation, and the
tool made it unconditionally — so "edit the English, run the stamp" turned
`check:docs:translation` green over a mirror that still said the old thing. That
happened for real (a §2 count went 141 → 142 while the mirror still read 141) and
was caught only by a test that checks `sql/NNN` ranges for a different reason.

When a mirror's recorded hash is stale, re-stamping is now allowed only when the
mirror itself is modified in the working tree, or the source changed only in
whitespace since `HEAD` — the reflow case the tool exists for. Otherwise it
refuses, names the file, and exits 1. `--force-restamp` is the deliberate
override. Verified against all three cases.

It immediately surfaced pre-existing drift it had been papering over: §2 of the
Indonesian `PROJECT_STATE` said ADR `0000–0103` while the English source said
`0000–0106`. §2 is generated into the English file ONLY, so its mirror is
hand-maintained and had silently fallen three ADRs behind. Corrected here.
