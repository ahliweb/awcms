---
"awcms": patch
---

Harden sync HMAC v2 signature material against delimiter ambiguity (audit finding L1, GHSA-c972-3q5p-g3h4).

The v2 material `v2:<tenantId>:<nodeCode>:<timestamp>:<body>` was cryptographically ambiguous at the tenant/node boundary because `nodeCode` may contain `:` (schema `node_code text`, no format constraint): `(tenantId="A", nodeCode="x:y")` and `(tenantId="A:x", nodeCode="y")` produced byte-identical material and mutually-accepted signatures. This was confirmed NOT cross-tenant exploitable (a request's `tenantId` must be a valid UUID to reach tenant data via `withTenant`), but was a latent weakness in security-signature code.

`computeSyncSignatureV2`/`verifySyncSignatureV2` now require `tenantId` to be a UUID before the material is built — a UUID is a fixed 36 chars with no `:`, so the tenant field boundary is unambiguous. `computeSyncSignatureV2` throws on a non-UUID tenantId; `verifySyncSignatureV2` fails closed (returns `false`). Only `tenantId` is constrained — `nodeCode` is untouched, and the v2 material format is unchanged, so already-deployed v1/v2 nodes (whose tenant ids are UUIDs) are unaffected. v1 signatures (`computeSyncSignature`/`verifySyncSignature`) are not changed. Timing-safe comparison is preserved.
