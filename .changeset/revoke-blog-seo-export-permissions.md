---
"awcms": minor
---

Revoke `blog_content.seo.configure` and `blog_content.posts.export`
(ADR-0058 §C/§D, `sql/089`), completing the ADR and emptying the
permission-enforcement exception list.

Both were seeded by `sql/036` and declared by the descriptor, and neither ever
had an enforcer. They are revoked rather than surfaced for different reasons:
`seo.configure` is a second authorisation axis over
`seo_default_title`/`seo_default_description`, which
`blog_content.settings.configure` already governs through
`PATCH /api/v1/blog/settings`; `posts.export` has no export machinery anywhere
in the repo, so building one to justify a catalogue row would be the tail
wagging the dog.

Because `POST /api/v1/setup/initialize` grants the whole catalogue to each new
tenant's `owner` role, every tenant owner has been holding authority over two
actions nothing checks. No behaviour changes — nothing ever read them.

The migration deletes the role grants before the catalogue rows (the FK runs
that way), is idempotent, and ships no rollback: restoring the grants would
re-advertise a surface that does not exist.

`bun run access:permissions:enforcement:check` now reports **203/203 with zero
exceptions** — every declared permission in the repo has an enforcer.
