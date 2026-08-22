---
"awcms": patch
---

fix(blog-content): one control character in one title made the whole feed unreadable; and `LOG_LEVEL` had no value that both validated and worked

Two findings from the 17 August 2026 audit round that share a shape — a control
applied to the wrong copy, and a contract no value could satisfy.

**A6 — `/blog/{tenantCode}/feed.xml` and `sitemap-blog.xml` escaped as HTML.**
`escapeHtml` neutralises the five markup entities and passes C0 control
characters through. XML 1.0 forbids most of them **anywhere** in a document,
including as a numeric reference; HTML merely discourages them.
`validateTitleField` checks a post title's length and nothing else, and there is
no write-side stripping — so one stray control character in one title made the
whole channel non-well-formed and every reader rejected it. Not that item: the
feed.

ADR-0038 named `escapeXmlText` for exactly this. It was applied to the
`seo_distribution` serializers, which answer **404** in production, and not to
these two routes, which answer **200**.

The route's own docblock is why the wrong function looked right: *"escaped
through the same `escapeHtml` used for HTML (XML and HTML share the same five
entity escapes)"*. True, and not the whole difference. It has been corrected
rather than deleted — a false comment beside correct code is the next author's
instruction.

**D3 — `LOG_LEVEL` had no working value.** `config:validate` accepted `warn`;
the logger implements `warning`. `LOG_LEVEL=warn` therefore passed the validated
contract, matched no level, fell back to `info`, and the firehose kept shipping
while the operator believed they had quieted it — and `LOG_LEVEL=warning`, the
value that would have worked, was rejected.

Fixed on **both** sides and additively: the validator now accepts `warning`
(and keeps `warn`), and the logger canonicalises `warn` → `warning` with a
one-time notice naming the canonical spelling. Rejecting `warn` outright would
have been tidier and would have turned a silent no-op into a failed
`config:validate` on a deployment that is running right now, to punish a
spelling. An unrecognised value still falls back to `info` — the safe direction,
because the alternative is a deployment that logs nothing because somebody typed
`infoo`.

Also corrects `docs/PROJECT_STATE.md` §4: **A8 was already fixed** before this
round wrote it up. Both site-search rate-limit settings already go through
`parsePositiveIntSetting`, which handles the NaN half and the empty-string half.
The entry is marked rather than deleted, because an audit item describing a
defect that is not there sends the next reader looking for it.
