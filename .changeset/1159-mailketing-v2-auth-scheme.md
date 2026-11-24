---
"awcms": patch
---

feat(email): configurable Mailketing v2 auth scheme, default `X-Api-Token` (Issue #1159, ADR-0151 Q12). New `EMAIL_MAILKETING_V2_AUTH_SCHEME` (`x-api-token` | `bearer`; unset = `x-api-token`; any other value fails `config:validate` and, at runtime, defers queued mail as a configuration error without sending). Exactly one credential header is sent per request, by the send path, the health probe and the account probe. **Behaviour change for v2 only:** the default header moved from `Authorization: Bearer` to `X-Api-Token` because a live production consumer corroborates the latter (issue #1159 comment, 2026-11-14); set `EMAIL_MAILKETING_V2_AUTH_SCHEME=bearer` to keep the old form. v1 (the default API version) is unchanged. The scheme is still not a stage-2 verification of this adapter; `EMAIL_MAILKETING_V2_VERIFIED` stays the owner's call.
