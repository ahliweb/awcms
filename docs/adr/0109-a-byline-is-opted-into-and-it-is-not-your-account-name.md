🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0109-a-byline-is-opted-into-and-it-is-not-your-account-name.id.md)

# ADR-0109 — A byline is opted into, and it is not your account name

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** Issue #597 item 4; Issue #649 (which refused an individual byline and recorded why); ADR-0102 (organisation-level identity); ADR-0096 (your own account is not an administrative surface); ADR-0094 / ADR-0108 (subject rights); PRD LenteraKalteng §8

## Context

`awcms_blog_posts.author_tenant_user_id` has recorded who wrote every article since `sql/035`. **Nothing public has ever resolved it.** `structured-data-rendering.ts` says why in its own comment: emitting an individual editor's identity would be _"a new PII surface"_, so the JSON-LD `author` is the ORGANISATION.

That was the right call for #649 and it leaves a news platform whose articles are attributed to a masthead and never to a journalist — Issue #597 item 4, which stayed open because it is not only a missing field. Two questions had to be answered first, and they pull in opposite directions:

- a newsroom's byline is load-bearing (readers follow writers, and attribution is part of what makes reporting accountable);
- an internal account name is not a byline, and publishing one because somebody happened to write an article is exactly the disclosure #649 declined.

## Decision

**A byline is a separate, nullable, OPT-IN field on the author's membership row, and `NULL` — the state of every existing row — means the organisation-level attribution ADR-0102 already ships.**

`sql/146` adds `awcms_tenant_users.public_byline_name`. Nothing about any existing article changes until a person fills it in.

### Not `awcms_profiles.display_name`, and this is the whole decision

Publishing the display name would have been one line and no migration. It turns every internal account name into public data the moment an article publishes, for every author, with nobody having chosen it — and in a newsroom the byline is frequently NOT the account name: a pen name, an initialled form, a name in a different script.

Opt-in also makes the failure mode benign. The way this feature breaks is "an author's byline is missing", which the author can see and fix. The way the display-name version breaks is "a staff member's name is on the internet", which they cannot undo.

### On `awcms_tenant_users`, not on the profile

`awcms_profiles` holds every party a tenant knows — customers and organisations included — and a byline on a customer record is meaningless. `awcms_tenant_users` is exactly the population that can author. It also makes the byline **per-tenant**, which is right for a principal who writes for two newsrooms under two names, and it puts resolution one join from the post rather than two.

### Self-service only, with no administrative sibling

Written through `PATCH /api/v1/auth/profile` — the ADR-0096 route that accepts no id, so the row it writes is the one behind the calling session and there is nothing to point elsewhere. There is deliberately **no permissioned endpoint for setting somebody else's byline**: an editor who could do that could publish an article under a colleague's name.

The field is OPTIONAL in the body and the three states are distinct: absent leaves it unchanged, `null` (or an empty string) clears it, a string sets it. Absence cannot mean "clear", or saving a display name would delete the byline every time.

### The `Person` node carries a name and nothing else

When a byline is set, the JSON-LD `author` becomes `{ "@type": "Person", "name": … }`. No `url`, no `sameAs`, no identifier. A byline is a name somebody chose to publish under; a linked profile is a staff directory nobody asked for and which the person cannot withdraw article by article. The `publisher` node is untouched — the newsroom still publishes it.

### One query per page, not per post

The `?view=full` feed resolves bylines for the whole page in a single batched lookup, alongside the term and institution lookups it already makes. This is the shape #649 argued for when the feed did not carry an article's categories: _"taking it per post means one extra query per post"_ is true, and the conclusion does not follow, because a page of fifty posts needs one query holding fifty ids. The integration test asserts a query CEILING over 32 posts, and that ceiling fails when the lookup is made per-post (verified by making it so).

### Erasure destroys it

`awcms_tenant_users` gains its first personal column, so its subject-data descriptor returns to `anonymize` naming exactly this column (ADR-0108). A byline that survived an erasure would leave the person's name under every article they wrote — the most visible place a name can survive.

## Consequences

- **Positive:** Issue #597 item 4 is closed on this side, and a newsroom can attribute reporting to the person who did it.
- **Positive:** no existing article's attribution changes, and no staff name becomes public without a deliberate act.
- **Positive:** the value is per-tenant, so a shared deployment cannot leak one newsroom's byline into another's site.
- **Negative / trade-off:** two names now exist for one person — the internal display name and the public byline — and an operator has to understand which is which. The account screen's hint says it in one sentence; nothing else surfaces the distinction.
- **Negative / trade-off:** a byline is free text, so it can be wrong, stale, or somebody else's name. That is inherent to bylines; the mitigation is that only its owner can set it, and every article they wrote shows it.
- **Neutral:** a guest contributor who has no account cannot be given a byline. That would need a per-post free-text field, which is a place a name could survive an erasure — deliberately not built here.

## Alternatives considered

- **Publish `awcms_profiles.display_name`.** Rejected — see above. Zero new fields, and it makes public a name nobody chose to publish.
- **A free-text `byline` column on the post.** Rejected for this round. It handles guest contributors and pen names with no account, and it puts a person's name in the article row where an erasure keyed on the author link does not reach it: it would need its own subject-rights answer, or it becomes the place a name outlives an erasure request. Worth revisiting as its own decision, with that answer written first.
- **A per-post override on top of the account-level byline.** Rejected as premature: it is the free-text column with an extra branch, and it multiplies the states an editor has to reason about before anyone has asked for it.
- **Keeping organisation-level attribution only.** Rejected: the constraint that produced it (#649's "no public-safe author name concept") is exactly what this ADR removes.
