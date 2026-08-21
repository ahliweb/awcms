---
"awcms": minor
---

feat(blog-content): an editor can see the article instead of guessing (#592)

An editor wrote a body in a `<textarea>` and then guessed how it would appear.
Not a poor preview — none at all. Since #624 the reader gets the canonical
Portable Text rendered, so bold is bold and a link is a link, which makes the
editing box and the published page differ more than they used to. Guessing got
harder, not easier.

`GET /admin/blog/{id}/preview` renders the article through
`renderBlogBodyHtml` + `renderPublicPageShell` — **the same two functions**
`/blog/{tenantCode}/{slug}` calls. Not a copy: a preview that re-implements the
template drifts, and a preview that lies is worse than none, because an editor
trusts it and ships the difference. A test asserts there is no second renderer
here rather than trusting the comment.

### Why in this repo rather than `awcms-astro`

That repo is a static build declaring zero authenticated surfaces, and its own
suite goes red when a route leaves `output: 'static'` without saying so. Using
its admin-surface door would make the public template carry sessions, SSR and CSP
work — and PRD §45.10 still lists that decision as OPEN. This repo already has
the session, the chokepoint, the audit trail and the public templates.

### A draft cannot escape through this URL

The post is read through the ADMIN directory, because seeing a draft is the whole
point — the public predicate would find nothing. That makes three things
load-bearing rather than decorative:

- `X-Robots-Tag: noindex, nofollow`, fixed rather than derived from the article's
  own visibility: previewing a `public` article must still not index *this* URL.
- `Cache-Control: private, no-store`, on the success path and on the 403.
- The path is pinned in `MUST_NEVER_MATCH`, so a shared cache cannot hold one and
  serve a draft to whoever asks next.

No canonical URL and no JSON-LD are emitted — fabricating either would tell a
crawler something untrue about a URL that must never be crawled. The route writes
nothing: no INSERT, UPDATE or DELETE, asserted.

No ad slots and no share buttons. Rendering an advertiser's creative into an
editor's preview would count an impression nobody saw. Internal tag linking is
likewise absent — it is a render-time transform over published terms, and showing
it would suggest a draft already carries links it only gets on publication.

Gated by `blog_content.posts.update` through `loadAdminScreen`: no new
authorization path, and the person who may change the article is the person who
may see it unpublished. A denied caller gets 403, not 404 — they have already
proved who they are, so hiding the article's existence would only send them
looking for a bug instead of asking for the permission they lack.

**Still open on #592:** the in-place editing overlay. This delivers the preview it
sits on top of.
