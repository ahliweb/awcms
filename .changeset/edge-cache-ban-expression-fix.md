---
"awcms": patch
---

Fix edge-cache invalidation, which had never worked.

The ban expression built by `infra/varnish/default.vcl` used `(^| )key( |$)` to
anchor a surrogate key to a whole token. Varnish parses a ban expression by
splitting it on **whitespace** into `<field> <operator> <argument>`, so the
literal spaces inside that regex produced the wrong token count and every ban
was rejected with `Wrong number of arguments`.

Nothing surfaced it. The VCL's BAN handler returns `200` regardless, so
`sendEdgeCachePurge` recorded success, the queue row was marked done, and the
object stayed cached until its TTL expired. The subsystem reported healthy
invalidation while performing none — the precise failure mode ADR-0042 exists to
prevent. It was found by putting Varnish in front of staging and watching
`X-Cache` stay `HIT` after a purge.

Both sides now emit `(^|[[:space:]])key([[:space:]]|$)`: same boundary semantics,
no literal space. Quoting the regex is not an alternative — the split happens
before quote handling (verified against Varnish 7.5).

Also corrects `infra/varnish/docker-compose.varnish.yml`, which named
`varnishcache/varnish:7.5`. No such Docker Hub repository exists, so adopting the
overlay failed with `pull access denied`. The image is `varnish:7.5`.

Guarded by two file-level assertions in `tests/edge-cache.test.ts`, because the
runtime expression is built in VCL rather than TypeScript and no unit test of the
origin can observe it.
