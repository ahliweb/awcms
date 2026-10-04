---
"awcms": patch
---

fix(security): validate the `Idempotency-Key` request header (1 to 255 visible ASCII characters, otherwise `400 IDEMPOTENCY_KEY_INVALID`) once in the middleware, and treat SQLSTATE class 54 as caller input rather than a database failure.
