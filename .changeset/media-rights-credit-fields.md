---
"awcms": minor
---

feat(media-library): expose verified photo credit fields on the public media DTO (Issue #782)

`ResolvedMediaReferenceDTO` (`_shared/ports/media-library-port.ts`), returned by `GET /api/v1/media/objects` and every in-process `MediaLibraryPort.resolveMediaReferences` consumer, gains `creditLine`, `sourceName`, and `copyrightStatus` — the photo credit a news site is legally/reputationally obliged to show, which existed on the registry row (`sql/137`, Issue #615) but never crossed the public read boundary.

The three fields are populated ONLY when the source media object's internal `rightsVerificationStatus` is `'verified'`; on anything else (the default `'unverified'`, or an explicit `'rejected'`) all three come back `null` — fail-closed, never a partial/best-effort value, even when the underlying row has them set. `rightsVerifiedBy`/`rightsVerifiedAt` (an internal reviewer identity and review moment — same posture ADR-0109 already took for the opt-in byline) and `rightsNotes` (editorial-internal licensing/contact terms) never cross into this DTO at all, in any case. See `media-library/domain/media-rights-policy.ts#resolvePublicMediaRightsFields` for the gate.

No new endpoint and no new permission — this widens data already returned by the existing `media_library.media.read`-gated route.
