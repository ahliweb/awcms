---
"awcms": minor
---

feat(admin-ui): articles stop publishing with no meta description and no canonical

`POST`/`PATCH /api/v1/blog/posts` have accepted `seoTitle`, `metaDescription`
and `canonicalUrl` all along. The form offered none of them, so **every article
published without any**, and `seo_distribution` then faithfully rendered that
absence into `<head>` and into every share card.

Both forms now carry the three fields.

### The asymmetry between the two forms is the point

They are not wired the same way, because the two endpoints read absence
differently:

- **Create** omits an empty field. Absent means "none", and `seoTitle` rejects
  `""` outright — sending a blank would 400 a form the author simply left empty.
- **Edit** sends `null`. On `PATCH`, absent means "leave unchanged", so omitting
  a cleared field would make these **write-once**: an editor who deletes a wrong
  meta description would watch it come back.

A contract test pins both spellings, because the two look interchangeable and
are not.

### Bounds come from the validator, not from the template

`MAX_SEO_TITLE_LENGTH` and `MAX_META_DESCRIPTION_LENGTH` are now exported and
used for `maxlength`. A hand-typed `70` would be the two-copies-of-one-value
shape this repo keeps getting bitten by: they agree until one is edited, and the
failure surfaces as a browser accepting what the server refuses.

Field labels are mapped too — without that, a rejected `metaDescription`
surfaces under its raw API name, which matches no label on the page.

### Also fixes a stale header

`/admin/blog`'s module header still described the plain-paragraph `<textarea>`
and `lib/ui/blog-body-editor` that #606 replaced with the Portable Text block
editor. Corrected, along with what is still deliberately absent (terms,
featured media).
