---
"awcms": patch
---

fix(whatsapp-delivery): sender routing hardening left open by the #1141 security audit (Issue #1231; M4 is deliberately not changed and is recorded as an open decision in the module README).

- **M2 per-sender quota race.** The allowance and the claim now run in ONE transaction under a `pg_advisory_xact_lock` keyed on tenant and sender (one lock per transaction, taken first, never held across a send), so overlapping passes or workers can no longer each claim up to their share against the same allowance. The per-sender breaker stays in-process.
- **L1 late revocation.** The sender verdict and the built provider (decrypted token in memory) are dropped and resolved afresh every `WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS` rows (new, optional, default 10; `1` re-checks every row). A sender revoked mid-pass fails closed from the next re-check. The remaining window (at most N rows plus the row in flight) is documented.
- **L5 lane fairness.** A sender already at its hourly or daily cap is reported as `quota_reached` but no longer takes a fair share or a discovery slot from healthy senders.
- **L4 wording.** The route comment and the OpenAPI text for `PUT /api/v1/whatsapp/sender-policy` now state the real order: `prepare` (Idempotency-Key, body size, JSON) runs before the permission check; only the schema validation follows authorization.
- **L6 database guards (`sql/329`).** The message insert guard also requires a WhatsApp number shape (`whatsapp_cloud` phone number or `starsender` device); the policy guard requires a `connected` default of that shape when a default is stored or changed. Capability stays an application check.

Operator action: run `bun run db:migrate` (applies `sql/329`, forward-only, replaces two trigger functions in place). `WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS` is optional; the job env allowlist gained that one name (`ops/awcms-jobs.env-global`, new fingerprint): redeploy the regenerated `ops/awcms-jobs.env-*` files if you deploy them.
