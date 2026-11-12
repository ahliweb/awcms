---
"awcms": minor
---

feat(edge-cache): `EDGE_CACHE_PUBLIC_SURFACES=always` makes declared public surfaces cacheable at the edge and the CDN regardless of the auto-mode load latch (Issue #1284, ADR-0161). Declared surfaces advertise their TTL in `Surrogate-Control` and `Cache-Control: s-maxage` (clamped to `EDGE_CACHE_MAX_TTL_SECONDS`). **Default `pressure` preserves current behaviour**, `off` stays inert, and the fail-closed allow-list (ADR-0042), the per-request exclusions (authorization, `awcms_*` cookies, `Set-Cookie`, `private`/`no-store`, unlisted query parameters, unresolved tenant) and the cache key and `Vary` rules (ADR-0098) are unchanged. `validate-env` warns when `always` is combined with a ceiling above the accepted 300 second staleness bound while purge does not reach the CDN.
