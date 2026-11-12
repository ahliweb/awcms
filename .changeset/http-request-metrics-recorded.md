---
"awcms": minor
---

feat(observability): record `http_requests_total` and `http_request_duration_ms` for every HTTP response (Issue #1287). `src/middleware.ts` wraps its whole handler in `instrumentHttpRequest`, so rendered responses, redirects, early rejections and a thrown error (recorded as 500 and rethrown unchanged) all produce a count and a duration, labelled with `method`, Astro's static `routePattern` and the status code only. A pattern that is not an absolute route pattern, carries a query or fragment, or contains a UUID or long digit run is recorded as `unmatched`; an unknown method as `OTHER`. The default metrics port stays a no-op, so a deployment that registers no adapter records nothing and pays two small label objects per request. No adapter or scrape endpoint is added or registered by default.
