---
"awcms": patch
---

fix(security): a suspended tenant could still rewrite its profile, change its password and mint new sessions

ADR-0073 made suspension a SERVICE status rather than a login status, and put the
refusal in the two places that decide access: `authorizeInTransaction` and
`ssr-session.ts`. Neither of those is on the path of
`defineSelfServiceTenantRoute` or `defineClientCredentialTenantRoute` — the two
factories that deliberately have no `AccessRequest` to consult — so twelve routes
kept serving a suspended tenant's live session.

Verified against a real database before the fix: `PATCH /api/v1/auth/profile`
answered **200** for a suspended tenant.

The one that matters most is the pair `POST /api/v1/auth/session-handoff/issue`
and `.../redeem`: they MINT a session. A session that would have expired renews
itself, so the foothold outlives the TTL suspension exists to drain — the
suspension never finishes.

`push/subscriptions/index.ts` did carry the check, by hand, on `POST` only. Its
`DELETE` sibling did not, and that asymmetry is what shows the omission was
accidental rather than a decision: a per-route copy is enforced by whoever
remembers, and eleven other routes in the class did not.

**The refusal now belongs to both factories**, one `awcms_tenants` primary-key
read on an RLS-free table, with the platform-tenant resolution behind the `&&` so
it runs only for a tenant that is already refused. A missing row reads as
stopped.

**Omitting the declaration REFUSES.** A route that must stay reachable states
`allowedWhileTenantSuspended: "<reason>"` — a reason rather than a boolean, for
the same discipline `SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS` carries: `true`
can be added in a diff without anybody saying what it buys. Four routes declare
one, and they follow one rule: **a suspended tenant may still SEE its own
security state and may still do things that only ever REMOVE its own access.**
Listing your sessions, ending one, ending all of them, and unregistering a push
device. A suspension that stops a customer from ending a stolen session is
protecting the attacker.

`api:tenant-route:check` now also fails any file under `src/pages/api` or
`src/pages/admin` that calls `isTenantServiceStopped` itself, so the copy cannot
come back. Comment lines are skipped, so a docblock explaining that the factory
owns the refusal is not read as a route deciding it.
