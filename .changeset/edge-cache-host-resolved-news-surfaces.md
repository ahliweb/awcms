---
"awcms": minor
---

Host-resolved public surfaces can be cached at the edge (ADR-0061 §A).

ADR-0042 §8 defines two sources for the tenant a cached object is tagged with,
and prefers the one a route publishes on `locals.edgeCacheTenantId` — the only
source available to a surface whose tenant comes from the request rather than
from a path segment. That branch had no writer anywhere in the repo, so it was
unreachable and every host-resolved surface was uncacheable by construction:
edge caching accelerated `/blog/{tenantCode}/**` (the legacy shape) and nothing
of the `/news/**` family that ADR-0059 made the go-forward one.

The four `/news/**` routes now publish their resolved tenant through
`publishEdgeCacheTenant`, and the registry declares `news-index`,
`news-taxonomy` and `news-post` — mirroring the TTLs and reasoning of their
`blog-*` counterparts, owned by `blog_content`, whose existing module purge
already invalidates them.

Publication happens only on the path that actually serves the resource. A 404 is
a cacheable status, so publishing before the "no such post/term" branch would
annotate a missing-resource 404 with `Surrogate-Control` while an unknown-host
404 gets `private, no-store` — answering "does this hostname map to a live
tenant?" from one request, through a second channel over the question the
route family's latency padding exists to close.

No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset
(every deployment's default) the whole subsystem remains a no-op.
