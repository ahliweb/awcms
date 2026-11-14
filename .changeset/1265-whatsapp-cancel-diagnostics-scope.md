---
"awcms": patch
---

fix(whatsapp_delivery): message cancel and diagnostics honour the caller's business-scope confinement (Issue #1265). `POST /api/v1/whatsapp/messages/{id}/cancel` now cancels only messages whose own business scope the caller holds (descendants included, decided through the access chokepoint); another brand's message, an unscoped one and an unknown id are one `409 WHATSAPP_MESSAGE_NOT_CANCELLABLE`, and the row is untouched (no existence oracle). `GET /api/v1/whatsapp/diagnostics` and `/admin/whatsapp` show a confined caller only the counts, messages and delivery attempts of the brands they hold; unscoped rows are hidden from them and the tenant-wide `suppressions` / `grantedConsents` totals are `null` (OpenAPI: nullable). Unconfined callers are unchanged. A channel module that cannot be loaded hides every row (fail-closed). No migration.
