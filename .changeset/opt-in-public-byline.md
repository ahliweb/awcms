---
"awcms": minor
---

feat(identity-access,blog-content): an author's opt-in public byline (ADR-0109, #597 item 4)

`awcms_blog_posts.author_tenant_user_id` has recorded who wrote every article
since `sql/035` and nothing public has ever resolved it —
`structured-data-rendering.ts` says why in its own comment: emitting an
individual editor's identity would be "a new PII surface", so the JSON-LD
`author` is the ORGANISATION. The result is a news platform whose articles are
attributed to a masthead and never to a journalist.

The obvious fix — publish `awcms_profiles.display_name` — is one line and no
migration, and it is refused. It turns every internal account name into public
data the moment an article publishes, for every author, with nobody having
chosen it; and in a newsroom the byline is frequently NOT the account name.

So `sql/146` adds a separate, nullable, opt-in
`awcms_tenant_users.public_byline_name`. **`NULL` — every existing row — means
the organisation-level attribution ADR-0102 already ships**, so no existing
article's attribution changes.

- On the membership row, not the profile: `awcms_profiles` holds every party a
  tenant knows, and it makes the byline per-TENANT — right for a principal who
  writes for two newsrooms under two names.
- Written only through `PATCH /api/v1/auth/profile` (ADR-0096: accepts no id).
  There is deliberately **no administrative sibling** — an editor who could set
  somebody else's byline could publish an article under a colleague's name.
- Optional in the body, with three distinct states: absent leaves it unchanged,
  `null`/`""` clears it, a string sets it.
- The JSON-LD `author` becomes a `Person` carrying the name and nothing else —
  no `url`, no `sameAs`, no identifier.
- The `?view=full` build feed gains `authorByline`, resolved for a whole page in
  ONE batched query. The integration test asserts a query ceiling over 32 posts
  that fails when the lookup is made per-post.
- `awcms_tenant_users` gains its first personal column, so its subject-data
  descriptor returns to `anonymize` naming exactly it (ADR-0108): a byline that
  survived an erasure would leave the person's name under every article they
  wrote.

The account screen gains the field, in both locales.
