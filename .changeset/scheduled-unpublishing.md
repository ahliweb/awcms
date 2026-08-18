---
"awcms": minor
---

feat(blog-content): an article can now be scheduled to stop, not only to start

`scheduled_at` and `blog:publish:scheduled` have handled the appearing half
since Issue #541. The withdrawing half did not exist: the transition table
offers `published -> archived | draft`, both manual, and `unpublish` appeared
nowhere in `src/` or `sql/`.

For a newsroom that is not an edge case. An embargo that lifts, a campaign page
whose contract ends, partner content with a paid window — every one of them was
held open by somebody remembering to archive the post, at an hour nobody is
monitoring. What failed silently was not the system; it was the person.

`awcms_blog_posts.unpublish_at` (sql/133) closes the window, and the existing
job archives the post when it arrives.

### Four decisions worth stating

**One job, two sweeps — not a second cron entry.** Two descriptors mean two
schedules, and two schedules drift: an operator disables one, or a container
ships a crontab with a single line, and posts publish forever while nothing ever
withdraws them. That failure is invisible, because the site looks like it is
working. Publish runs first, so a window that opens and closes inside one tick
resolves in the right order rather than being skipped.

**No content quality checklist on the withdrawal.** The publish sweep gates on
it because publishing exposes content to readers. Withdrawing exposes nobody,
and a checklist that could BLOCK a withdrawal would hold an expired embargo open
on the strength of a missing alt text — the exact inversion of what the gate is
for.

**`unpublish_at` is NOT cleared on transition, unlike `scheduled_at`.** The two
are not symmetric: `scheduled_at` is an intent already carried out that would
re-fire if kept, while `unpublish_at` is the record of a window that is still
open. Clearing it when the post publishes would silently cancel the withdrawal
the editor set in the same action.

**Pages deliberately do not get the column.** `awcms_blog_pages` carries
Redaksi, Pedoman Media Siber and Disclaimer — the legal surface a news site is
required to keep reachable. A scheduled unpublish there would let a tenant
remove, on a timer and with no editor in the loop, the page a press council
expects to find.

### A defect class caught on the way

`BlogPostRow` is populated by a CAST (`as BlogPostRow[]`), and a cast is an
assertion, not a verification — so adding a field to the type, to `toView()`,
and to ONE of the eight column lists typechecks perfectly while the other seven
silently return `undefined`. `undefined` is not `null`: it serialises to a
missing key, so the field vanishes from the API response for exactly the reads
that forgot it. The first patch here hit precisely that, and nothing failed.
`tests/blog-post-column-list-parity.test.ts` now fails when any column list
drops a declared field, and it was verified to fail before it was trusted.
