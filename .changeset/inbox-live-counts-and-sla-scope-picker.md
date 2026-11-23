---
"awcms": minor
---

feat(omnichannel-inbox): live work-counts panel and SLA policy scope picker on the admin screens (Issue #1164). `/admin/omnichannel-inbox` shows open, pending, awaiting-reply, unassigned and overdue counts for holders of `omnichannel_inbox.status.read`, fed by the existing status snapshot and SSE stream (counts only, scope-confined, no message or customer data); it falls back to a refresh button and bounded polling when the stream is unavailable, with a polite live region that stays silent when nothing changed. The shared `delivery-progress-client` accepts the panel's own count keys. `/admin/omnichannel-inbox/settings` lets a policy manager pick the business scope a new SLA policy applies to (scopes of the tenant's channel accounts, narrowed for a scope-confined caller; the endpoint still re-authorises). The `omnichannel_inbox.status.read` ledger entry is removed. No schema, API or event change; English and Indonesian strings added.
