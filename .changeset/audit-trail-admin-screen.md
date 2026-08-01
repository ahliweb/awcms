---
"awcms": minor
---

Add the `/admin/audit-trail` viewer and put `logging` in the admin sidebar.

`logging` has exactly one HTTP surface (`GET /api/v1/logs/audit`) and had no screen, so the tenant's audit history — the record of every high-risk action the system takes — was readable only by `curl`. For the module whose whole purpose is accountability, that is a poor place to have no UI.

The screen lists events newest-first with a resource-type filter and a per-event detail disclosure (correlation id + the already-redacted `attributes`, rendered as escaped text, never as HTML). It is read-only and ships **no client script at all**: the audit trail is append-only by design, so the filter is a plain `method="get"` form that works with JavaScript disabled.

`listAuditEvents` clamps to 100 rows and has no cursor, so the page states that bound whenever the view is full rather than letting a truncated audit log read as "this is everything that happened". Adding keyset pagination to that endpoint is a follow-up with its own OpenAPI change, deliberately not smuggled in here.
