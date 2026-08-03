---
"awcms": minor
---

Ownership-based grants now run through the authorization chokepoint (ADR-0063).

Three handlers — `PATCH /api/v1/blog/posts/{id}`,
`POST /api/v1/blog/posts/{id}/submit-review` and `PATCH /api/v1/blog/pages/{id}`
— decided permissions themselves from `fetchGrantedPermissionKeys` plus a domain
rule, never calling `authorizeInTransaction`. That skipped the ABAC evaluator,
the ADR-0053 platform-scope gate, ADR-0060 business-scope facts and #181 SoD. The
visible consequence: a tenant's explicit ABAC `deny` was honoured on some routes
and silently ignored on these three.

None of the three was sloppiness. They enforce the product rule that an author
may edit their own unpublished content **even without** holding the permission —
an authorization axis the permission catalogue cannot express — while the
chokepoint returns `denied` before any domain rule is consulted. Putting it in
front would have deleted the author path: a functional regression that looks like
a security tightening.

`authorizeInTransaction` therefore gains `ownershipGrant`, which **widens** the
permission set being evaluated instead of short-circuiting the decision. Tenant
isolation, an ABAC deny, business scope and SoD can all still refuse. Machine
credentials are excluded, since a credential authenticates and never authorizes.
The decision log labels ownership allows `ownership_grant:<reason>` so an auditor
can tell them from RBAC allows.

New gate `bun run access:chokepoint:check` holds the class: every handler calling
`fetchGrantedPermissionKeys` must go through the chokepoint or be a reasoned
exemption keyed `<file>#<METHOD>`. It slices **per handler**, because a per-file
reading is what produced the original mis-analysis — `blog/posts/[id].ts` calls
the chokepoint in `GET` and `DELETE` while `PATCH` did not. Two exemptions:
pre-authentication login, and the self-introspection endpoint that calls
`evaluateAccess` directly.

Behaviour changes in one direction only: an action that previously slipped past
ABAC can now be refused by a tenant's own policy.

No migrations, no new permissions, no OpenAPI change.
