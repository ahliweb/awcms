---
"awcms": patch
---

fix(identity-access): enforce the 24h delegated access code TTL (from the grant's `created_at`) in both the redemption lookup and its compare-and-swap UPDATE, bind redemption to the grant's `partner_tenant_id` (the redeemer's source tenant; a mismatch returns the existing `CODE_INVALID`), and make `validateDelegatedGrantTtl` reject an Invalid Date instead of accepting it. No schema change; error codes and response shapes are unchanged.
