---
"awcms": minor
---

Add `/admin/security` — the screen for authentication policy that the endpoints
have been waiting for since #184/#185.

Tenant auth policy (password/SSO/break-glass/JIT/allowed domains) and MFA
enforcement have been fully implemented and guarded for two releases, reachable
only by hand-writing `curl`. This renders them: deployment posture (read-only),
the tenant authentication policy, MFA enforcement level, and a read-only list of
configured OIDC providers.

**It adds no enforcement of its own.** Every mutation posts to the real endpoint
and inherits its ABAC guard, its break-glass rule and its audit row. The
permission checks decide what to render, never what is allowed.

**The gates reuse the endpoints' exact permission keys** — including
`mfa_admin.reset` as the MFA *read* gate, which reads like a mistake and is
precisely what `GET /api/v1/auth/mfa/policy` requires. Inventing a friendlier
`mfa_admin.read` that no migration seeds would hide the section from everyone
including the owner, which is the latent-authz bug this repo has already shipped
twice. `tests/admin-security-page-contract.test.ts` extracts the guard triples
from the route sources and the `permissionKey(...)` triples from the page and
requires the second to be a subset of the first; mutation-proven — swapping in
`mfa_admin.read` turns three tests red.

**Deployment posture is shown because the tenant policy cannot be judged without
it.** `ssoRequired` with `AUTH_SSO_ENABLED=false` produces a tenant nobody
outside the break-glass list can sign into, and that contradiction was
previously invisible from any screen. It now renders as a warning. No key or
secret value is displayed — only whether a control is active.

**The break-glass picker deals in identity ids**, not tenant_user ids: the
policy column stores identity ids, both are uuid, and passing the wrong one is
accepted by the endpoint, filtered out as ineligible, and saved as an empty
list — a silent no-op exactly where an operator is trying to keep themselves
able to log in. New `listBreakGlassCandidates` uses the same predicate as
`fetchEligibleBreakGlassIdentityIds`, and an integration test pins the two
together across inactive identities, inactive memberships, locked identities and
cross-tenant rows, so the picker can never offer an option the save path
discards.

`409 BREAK_GLASS_REQUIRED` surfaces verbatim rather than collapsing into a
generic failure: the caller is already an authenticated admin holding
`sso_policy.update`, so it leaks nothing they cannot read directly, and a
generic message would leave them retrying the one change the server will never
accept.

OIDC provider CRUD stays API-only — a form that posts a client secret deserves
its own change.
