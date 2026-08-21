---
"awcms": minor
---

feat(blog-content): advertising inventory can finally be booked from a browser

`awcms_news_portal_ad_placements` was the most complete subsystem in this repo
that nobody could operate: twelve slots, four rotation modes, `global`/`widget`/
`post`/`page` targeting with the pairing rule enforced as a database CHECK,
scheduling, and every creative holding a real foreign key to a verified media
object — reachable only through `curl`.

`/admin/blog-ads` books it. The table is built from the SLOTS, not from the
rows, so an unsold slot renders its availability notice (FR-ADS-007) instead of
being indistinguishable from a slot that does not exist, and each one states its
recommended size and its render-time item cap — an operator who cannot see that
number will load six banners into a one-banner slot and conclude the rotation is
broken.

The creative goes through the one shared media picker, the same one the article
editor uses. A `global` placement sends `targetId: null` rather than `""`,
because the pairing rule is a database CHECK and an empty string violates a
constraint the operator never chose.

Three client helpers move into `admin-form-client.ts` in the same change —
`localDateTimeToInstant`, `checkboxChecked`, `integerValue` — because this is
the second screen to need all three, and `/admin/blog-homepage` now imports them
instead of carrying its own copies. The first of the three is not a convenience:
`datetime-local` carries no zone, so a schedule parsed on the server is read in
the server's timezone and a campaign booked from Palangka Raya starts at the
wrong hour with nothing reporting an error.

No permission and no migration: both keys were seeded by `sql/045` and repointed
by `sql/076`. `NOT_YET_SCREENED` loses its last two `blog_content` entries other
than the internal-link policy.

Part of #594.
