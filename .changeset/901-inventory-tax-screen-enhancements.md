---
"awcms": patch
---

feat(admin): structured tax editor, location rename/office link, balance rebuild screen

`/admin/tax` gets a structured definition editor (categories, rules, stacked
components, pricing/rounding untouched) that serialises into the same JSON
textarea the form already submitted; the textarea remains the no-script
fallback and the source of truth, and the server stays authoritative. Rates are
exact decimal strings end to end.

`/admin/inventory` gets a rename / office-link control per location over the
existing `PATCH /api/v1/inventory/locations/{id}` (`inventory.locations.update`;
the endpoint existence-checks the office inside the tenant transaction), and a
"Rebuild balances" action over `POST /api/v1/inventory/balances/rebuild`
(`inventory.balances.rebuild`, confirmed, idempotent, audited at critical
severity, no quantity accepted). `inventory.balances.rebuild` leaves the
shrink-only admin-screen coverage ledger. No API, schema or permission change.
