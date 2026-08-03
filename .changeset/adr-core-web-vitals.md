---
"awcms": patch
---

ADR-0067 (`Proposed`) — Core Web Vitals collection, put as a decision rather
than left as an open gap.

This is the only one of the assessment's seven recommendations deliberately not
landed. It does not fix a defect; it adds collection of data about real
visitors, and that collides with a posture `visitor_analytics` has already
stated — its purge does DELETE/UPDATE-to-null with no archive step, on the
written grounds that raw visitor detail is deliberately not retained.

The gap it describes is real: LCP/INP/CLS are measured nowhere, so the entire
edge-cache investment is proven against origin load and never against user
experience.

Three options with their real trade-offs, recommending aggregate-only — buckets
per tenant, normalised route and day holding counts plus p75, never raw rows —
if it is taken at all. Not taking it is a legitimate answer, better recorded as
a decision than left open.

Awaiting the product owner's call.
