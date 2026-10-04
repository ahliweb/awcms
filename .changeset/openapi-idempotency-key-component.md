---
"awcms": patch
---

Document the `Idempotency-Key` bound in the OpenAPI contract: the 93 inline header declarations become one shared `components.parameters.IdempotencyKey` (1 to 255 visible ASCII, `400 IDEMPOTENCY_KEY_INVALID`) that matches the middleware bound, with a test pinning it to the runtime constants and a gate against inline redeclaration (ADR-0129, amending ADR-0026). No runtime change.
