---
"awcms": minor
---

feat(edge-cache): purge reaches the CDN, behind a flag that is off by default (Issue #1282, revisit of C14). **Nothing changes for a deployment that does not set `EDGE_CACHE_CDN_PURGE=on`**: no `Cache-Tag` header, no CDN call, the accepted staleness bound (`s-maxage` at most 300 seconds) is the behaviour.

With the flag on and `EDGE_CACHE_CDN_ZONE_ID` and `EDGE_CACHE_CDN_API_TOKEN` set (environment only, the token job-scoped to `edge-cache:purge`), the purge worker sends the Varnish BAN and then a Cloudflare purge-by-tag for the same surrogate key, 100 distinct tags per request. A row is `done` only when both succeed. A rate limit (429) or a rejected credential (401/403) stops CDN calls for the run and releases the rows without spending an attempt; a transient failure retries inline with backoff and then leaves the row to the queue's 5-attempt budget; any other 4xx dead-letters with the reason. With the flag on and a setting missing the worker refuses to run (exit 1) and `security:readiness` reports it CRITICAL, so the queue keeps every row. The worker reports `cdnPurged`, `cdnFailed`, `cdnReleased` and `cdnMaxLagSeconds` in its summary line and as `job_run_item_count`.
