---
"awcms": patch
---

security(procurement): a document's `approval_status` can no longer be set without the bound workflow instance deciding it (#1045, audit e10 of #1032, `sql/300`). The document status trigger now requires, at `draft -> submitted`, an instance of this tenant that names this procurement document, was requested by the submitter and agrees with the recorded status, and, whenever `approval_status` leaves `pending`, re-reads the instance `FOR SHARE` and requires a matching verdict (`approved`; `rejected` or `cancelled` for `rejected`). The runtime role could previously mark a document approved while its instance was still pending and then finalise it. The function pins `search_path` and schema-qualifies the instance table. No API or event contract changes; the engine's own submit, approve, reject, finalise and cancel paths are unchanged.
