---
"awcms": patch
---

docs(contracts): a PROVISIONAL, machine-validated AsyncAPI document for the booking, hr_payroll and WhatsApp delivery events, plus `docs/awcms/cross-domain-contracts.md` (capability ports, per-consumer idempotency, provisional-to-live migration) (#918 items 2-3). New gate `asyncapi:provisional:check` in the `check` chain; no runtime code, no live contract change.
