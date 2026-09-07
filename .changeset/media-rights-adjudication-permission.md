---
"awcms": minor
---

feat(media-library): split rights adjudication out of media.update (Issue #794)

`PATCH /api/v1/media/objects/{id}` used to gate its whole rights-metadata form — `creditLine`, `sourceName`, `copyrightStatus`, `rightsNotes`, AND `rightsVerificationStatus` — behind one permission, `media_library.media.update`. Since Issue #782/PR #791, setting `rightsVerificationStatus` to `'verified'` makes `creditLine`/`sourceName`/`copyrightStatus` cross into the public `GET /api/v1/media/objects` response, so whoever could type a credit line could also self-attest it cleared for publication, with no second reviewer.

A new, ninth media permission, `media_library.media.adjudicate_rights` (`sql/152`), now gates any transition of `rightsVerificationStatus`. A request that changes only routine fields still needs only `media.update`, unchanged. A request that changes `rightsVerificationStatus` alone needs `adjudicate_rights` alone — a rights reviewer role need not also hold `media.update`. A request that changes both needs both permissions. The new permission is seeded with no default grant beyond the standard new-tenant `owner` catalogue inclusion every permission gets — a tenant must consciously grant it to a designated reviewer role.

`/admin/media`'s rights-editor form and OpenAPI/`src/modules/media-library/README(.id).md` are updated to match.
