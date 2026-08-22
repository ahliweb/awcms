---
"awcms": patch
---

fix(blog-content): automatic tag linking only ever saw the alphabetically-first 100 tags

`resolveInternalTagLinkingContext` built its candidate list like this:

```ts
const allTags = await listBlogTerms(tx, tenantId, { taxonomyType: "tag" });
```

The local name says `allTags`. It was not all tags. `listBlogTerms` is the admin
screen's list: `ORDER BY name ASC`, bounded at a hundred. So on any tenant with
more than a hundred tags, automatic internal tag linking considered the
alphabetically-first hundred and silently ignored the rest.

**Nothing failed.** The feature rendered, the preview endpoint showed the
matches it did make, and an editor asking *"why was `Sepak Bola` not linked?"*
got no answer anywhere — the tag exists, it is enabled, it is spelled correctly,
and it happens to start with S. On the 23,906-article archive Issue #599 is
preparing for, the feature would have been operating on well under 5% of the
vocabulary while looking entirely healthy.

**The fix is not to remove the bound.** `createInternalTagLinkEngine` compiles
ONE alternation regex from every candidate, so an unbounded vocabulary means a
very large regex compiled on a public post render. The defect was not that a
bound existed — it was that the bound was inherited by accident from a function
written for an admin table, that it degraded **alphabetically**, which is the
least meaningful order available, and that nothing recorded when it was hit.

All three are addressed:

- `MAX_INTERNAL_TAG_LINK_CANDIDATES` is named and lives with the feature.
- `listTagLinkCandidates` orders by how many non-deleted posts carry the tag —
  the topics most likely to occur in prose. Assignments to soft-deleted posts do
  not count, so a tag left on five hundred deleted articles does not outrank one
  in daily use. Unused tags are still candidates; they only lose the tiebreak.
- The resolved context carries `vocabulary: { total, limit, truncated }`, and
  `GET /api/v1/blog/posts/{id}/internal-links/preview` returns it. Until now,
  "the tag is disabled", "the tag is shorter than `minTermLength`", "the tag is
  not in the body" and "the tag is past the cap" were the same empty `matches`
  list — and only the last of those is something an editor cannot fix by
  editing.

`total` counts the tenant's whole vocabulary including tags it has switched off,
because it answers "how big is this vocabulary", not "how many reached the
engine". Conflating them would report a truncated vocabulary for a tenant that
had merely disabled some tags.
