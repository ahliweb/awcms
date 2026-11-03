---
"awcms": patch
---

security(ssrf-guard): `ssrfSafeFetch` no longer re-sends credential headers to a different origin on a redirect (Issue #1242). Its redirect loop is manual, so the fetch standard's cross-origin rule never ran and every hop re-sent the caller's headers unchanged: a `302`/`307` to another public host received the `Authorization` or `Cookie` meant for the first one.

`Authorization`, `Cookie`, `Proxy-Authorization` and any header the caller names in the new optional `credentialHeaders` (case-insensitive, added to the defaults) are now sent only while the request stays on the original request's origin (scheme, host, port). The first hop that leaves it drops them, and they stay dropped for every later hop, including a return to the original origin. Non-credential headers still go on every hop, the redirect method and body rewrite, per-hop SSRF validation, hop cap, timeout and size cap are unchanged, and a caller that never meets a redirect sees no difference. No existing caller relied on a forwarded credential (audit table in `docs/awcms/standar-performa-dan-keamanan.md`), so no caller changed.
