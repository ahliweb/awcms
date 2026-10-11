---
"awcms": minor
---

Add the shared field-encryption helper and keyed-hash key ring (Issue #986, ADR-0137 sections 2-3; second consumer ADR-0140).

- **`src/lib/security/field-encryption.ts`.** AES-256-GCM with a versioned envelope `v2:<keyId>:<iv>:<tag>:<ciphertext>` (base64url, 12-byte random IV), the key id stored inside the value so rotation needs no schema change, and associated data binding purpose, tenant and row (length-prefixed encoding), so a ciphertext moved to another row, tenant or dataset fails authentication. The first ring key encrypts, every ring key decrypts.
- **Fail closed.** No default key; `keyId:base64` rings are refused when unset, malformed, placeholder, shorter than 32 bytes, constant, or duplicated. Errors are fixed strings per code and never carry key material or plaintext. `resolveKeyRing(envName)` is the seam a KMS provider replaces; the helper reads no consumer-specific variable, so nothing is required at boot.
- **Keyed hash.** HMAC-SHA256 with purpose and tenant domain separation returning `keyId:hex`, a candidates list under every ring key for lookups across rotation, and constant-time comparison.
- **Shared parser.** The `WHATSAPP_RECIPIENT_HASH_KEYS` ring parser now lives in the helper and `whatsapp_delivery` calls it; behaviour and messages are unchanged. The three older `v1` helpers are untouched. No table, migration or consumer wiring.
