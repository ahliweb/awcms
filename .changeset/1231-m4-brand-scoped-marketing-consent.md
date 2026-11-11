---
"awcms": minor
---

fix(whatsapp_delivery): a WhatsApp marketing opt-in now covers only the business scope (brand) it was collected for (Issue #1231 M4, owner decision of 2026-11-11, option (c); ADR-0148 I8). Before this change an opt-in recorded for brand A authorised marketing from brand B's sender.

- The consent stays one record per tenant and recipient. `sql/354` adds `business_scopes` (the brands an opt-in was collected for) and `unscoped_granted` (an opt-in for the tenant itself) to `awcms_whatsapp_consents`; `POST /api/v1/whatsapp/consents` takes an optional `businessScope`, authorised against the caller's business-scope confinement and resolved against the tenant (`422 SCOPE_UNRESOLVED`).
- Marketing of brand B is eligible only when the consent lists brand B; otherwise the enqueue is refused with the new, stable reason `CONSENT_SCOPE_REQUIRED` (nothing queued) and the dispatcher cancels a queued row with `consent_scope_required` before the send. An unscoped opt-in covers only marketing that names no brand. The `businessScope` of a marketing message must resolve to a real scope of the tenant (only `office` today), else `BUSINESS_SCOPE_UNRESOLVED`; it is the scope the caller declares, bound to the sending number only when the sender is itself scoped. Port `whatsapp_delivery` 1.2.0 (additive).
- Withdrawal and suppression stay tenant-wide: one opt-out ends every brand, and a reinstatement covers only the brand it names. A database CHECK refuses a withdrawn consent that still covers anything.
- **Existing consents are not backfilled with a brand.** They keep authorising marketing that names no business scope and authorise no brand-scoped marketing until an opt-in for that brand is recorded. A tenant that already sends brand-scoped marketing must record its brands' opt-ins: until then those sends are refused, loudly, and nothing is sent.
- The consent list and the grant response show only the brands the caller holds. A brand grant no longer rewrites the row's `source`/`grantedAt` (each brand keeps its own). A grant that loses a race to a withdrawal answers `409 CONSENT_WITHDRAWN`, never a 500.
- Transactional and security messages are unchanged. The `awcms.whatsapp.consent.granted` event gains `businessScope` for a brand grant (absent otherwise).
