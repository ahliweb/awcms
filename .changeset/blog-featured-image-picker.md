---
"awcms": minor
---

feat(admin-ui): an article can be given a featured image from the CMS

`featuredMediaId` has been accepted by `POST`/`PATCH /api/v1/blog/posts` all
along, and #610 gave `/admin/media` a way to get files in. Between the two there
was still no way to say **which** image belongs to a story without calling the
API by hand.

Both article forms now carry a picker.

### One picker, not two

`src/lib/ui/media-picker-client.ts` is deliberately generic and wired off
`data-target`/`data-label`, so the article editor and the ad inventory (#594)
share one implementation. The issue asks for exactly that — *"satu pemilih,
bukan dua"* — because two would drift, and the one that drifted would be the one
nobody was looking at.

### It adds no new permission to `/admin/blog`

The catalogue is read **from the browser** against
`GET /api/v1/media/objects/list`, which enforces `media_library.media.read`
itself. So this screen still gates on `blog_content.posts.*` and nothing else,
and the eleven-key contract stays intact — the page header names that constraint
explicitly, and a test now asserts no `media_library` gate appears here.

A caller who lacks `media.read` is **told so**, rather than shown an empty grid
that looks like an empty library and sends them hunting for an upload problem
that does not exist.

### Only verified, undeleted objects are offered

`/admin/media` deliberately renders no `<img>` — a row there can be
`pending_upload` or `failed`, and the screen exists partly so somebody can delete
a policy-violating image. That argument does not transfer to a picker, and the
difference is the status filter: this asks for `status=verified&deletion=live`,
the same set `isPubliclyReferenceable` admits.

Both halves matter. A soft-deleted object can still *be* verified while every
reference to it has already stopped resolving, so offering one would hand the
author an image that is gone.

### Clearing works

`featuredMediaId` is sent as `null` rather than omitted on both forms, for the
same reason the SEO fields are: on `PATCH`, absent means "leave unchanged", so an
omitted empty value would make the wrong photo impossible to detach.

### The asset gate fired, and its question was answered before the raise

`APP_BUDGET_BYTES` goes 172,000 → 178,000. The gate asks whether growth is
per-screen duplication (Issue #552's shape, where a shared module recovered
22,700 B). It is not — three features bought it:

```
after ADR-0101                      165,274 B
+ media upload UI       (#610)      169,128 B   (+3,854)
+ article SEO fields    (#611)      169,417 B   (+  289)
+ featured-image picker (this)      173,050 B   (+3,633)
```

The picker is a shared module imported by one screen today and by ad inventory
next, so its bytes are paid once rather than per screen. The reader budget is
untouched at 21,415 B — none of this reaches a public page.
