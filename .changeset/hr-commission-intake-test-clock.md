---
"awcms": patch
---

Make the `hr_commission` intake digest test deterministic: the request builder read the clock inside itself, so two requests built in one expression could differ by a millisecond and fail the "same request" assertion intermittently in the full run. Test-only; no runtime change.
