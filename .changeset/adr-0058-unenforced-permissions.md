---
"awcms": patch
---

ADR-0058 — disposition for the four declared permissions with no enforcer.

`profile_identity.profile_management.restore` and `comments.moderation.delete`
get a surface: both have all of their machinery except the endpoint. The first
leaves `softDeleteParty` without a counterpart, so `restored_at`/`restored_by`
can never be written and a soft-deleted profile is effectively permanent. The
second has a legal `delete` transition from all four non-terminal statuses and
an admin queue that can filter `deleted`, while the only actor able to produce
that state is the comment's own author.

`blog_content.seo.configure` and `blog_content.posts.export` are revoked: the
first is a second authorisation axis over columns `settings.configure` already
manages, the second has no export machinery anywhere in the repo.

Decision only — no code or migration in this change.
