---
"awcms": patch
---

fix(auth): stop misclassifying 304 Not Modified as a broken redirect in ssrfSafeFetch (ahliweb/omes#249)

`ssrfSafeFetch`'s manual redirect-following loop in `src/lib/auth/ssrf-guard.ts` treated every response with a status in `[300, 400)` as a redirect that required a `Location` header, failing with `request_failed` when one was missing. `304 Not Modified` legitimately has no `Location` — it is not a redirect at all — so a conditional GET (`If-None-Match`) answered with `304` was always misclassified as a broken redirect.

In production this hit `src/modules/omes-control/application/repository-progress-poller.ts`, which sends `If-None-Match` on its second-and-later poll of GitHub's milestones/issues endpoints: every unchanged-repository poll failed with `network_error` instead of the intended `not_modified` outcome, permanently marking the projection's `pollStatus` as `error` even though nothing was wrong.

Only `301`, `302`, `303`, `307`, and `308` are now treated as followable redirects requiring re-validated `Location` handling (unchanged SSRF re-validation logic for those). Every other 3xx status — `304`, plus `300`/`305`/`306` for completeness — is now returned to the caller as an ordinary completed response, without requiring or looking for `Location`.

`src/modules/omes-control/application/repository-progress-poller.ts` already had correct `not_modified` handling for a real `304`; no change was needed there once the guard was fixed.
