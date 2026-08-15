🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0052-idn-region-dataset-lifecycle-is-an-operator-job.id.md)

# ADR-0052 — Region dataset activation/rollback is an operator job, not a tenant endpoint

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision maker:** @ahliweb
- **Refines:** [ADR-0046](0046-idn-admin-regions-module-admission.md) (admission of the `idn_admin_regions` module) — it revokes the HTTP surface for two of its lifecycle actions, the rest still stands
- **Related:** ADR-0051 (which recorded this finding — PR #321, not yet merged when this ADR was written, hence referenced without a link so `check:docs` does not turn red over a link to a file that does not exist yet), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (read-only machine credentials), [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) (superseded by ADR-0051)

## Context

ADR-0051 §Context records an open finding, and this ADR closes it.

`idn_admin_regions` ships two lifecycle actions as HTTP endpoints:

| Endpoint                                          | Permission                            |
| ------------------------------------------------- | ------------------------------------- |
| `POST /api/v1/idn-regions/datasets/{id}/activate` | `idn_admin_regions.dataset.configure` |
| `POST /api/v1/idn-regions/datasets/rollback`      | `idn_admin_regions.dataset.restore`   |

Both swap the **dataset served to ALL tenants** — the table is global, with no `tenant_id`, no RLS. But `sql/081` seeds both permissions into the **global** ABAC catalogue, and `POST /api/v1/setup/initialize` grants the entire catalogue to the `owner` role of every new tenant (owner = 197/197). So **the owner of an ordinary tenant holds the authority to swap the data served to other tenants.**

ADR-0048 tried to contain this by moving its _screen_ to another repo. That never contained anything: ABAC evaluates permissions, not the frontend's origin, and the endpoint accepts `curl` from anywhere.

### Why "require machine credentials" was rejected — even though it was briefly the leading candidate

The first candidate was to gate both on ADR-0049 machine credentials. That **cannot be done without making things worse**:

```ts
// identity-access/domain/machine-credential.ts
export const MACHINE_CREDENTIAL_ALLOWED_ACTIONS: ReadonlySet<AccessAction> =
  new Set<AccessAction>(["read"]);
```

Machine credentials **may only `read`** (ADR-0049 §3), and `access-guard.ts` rejects anything else with `machine_credential_readonly`. `activate` needs `configure`, `rollback` needs `restore` — both writes. Gating both on machine credentials means **widening that allow-list**, and the comment at the source already warns why:

> "A leaked build token must not be able to change anything… Widening this set needs its own ADR: every addition is a new class of thing a stolen token can do."

The end result: a leaked build token could swap the region dataset for every tenant. That is **worse** than the bug being fixed.

Machine credentials are also conceptually the wrong mechanism: [ADR-0050](0050-bff-session-handoff-code.md) gives internal screens a **human session** through a handoff code, not a machine identity.

### The precedent already present in this very module

ADR-0046 §5 already answered the same question for this module's third action — import:

> Import is deliberately ABSENT from this catalog: it is a worker job (`bun run idn-regions:import`) running as `awcms_worker`, never an HTTP action, so there is no request-time subject for an ABAC guard to evaluate. Seeding a permission for it would advertise a surface that does not exist.

Activation and rollback fall in **exactly the same class**: operations on global reference data, run by a platform operator, with no sensible tenant subject to evaluate.

## Decision

We decide that **region dataset activation and rollback become an operator job (a CLI job), and their HTTP surface is deleted**:

1. `POST /api/v1/idn-regions/datasets/{id}/activate` and `POST /api/v1/idn-regions/datasets/rollback` are **deleted** (not disabled).
2. They are replaced by `bun run idn-regions:activate -- --dataset <code|id>` and `bun run idn-regions:rollback`, both **dry-run by default** and writing only with `--commit` — the same pattern as `idn-regions:import`.
3. The permissions `idn_admin_regions.dataset.configure` and `.restore` are **revoked** from the ABAC catalogue and from any role that already held them (`sql/084`), and removed from `module.ts`.

Two permissions remain for this module: `region.read` and `dataset.read` — both genuinely reads, genuinely evaluated per tenant, and safe for a tenant owner to hold.

> **The general rule this decision enforces** (ADR-0051 §Decision item 2): an action whose effect crosses the tenant boundary must not enter a catalogue seeded to tenant roles. If such an action has no platform subject to evaluate, it is not an endpoint — it is an operator job.

## Consequences

- **Positive:**
  - The cross-tenant hole is **gone**, not guarded. There is no HTTP surface to abuse and no tenant permission that confers the authority.
  - No new authorization primitive has to be designed, tested, and maintained.
  - All three of this module's lifecycle actions (import, activate, rollback) are finally consistent: all operator jobs, all dry-run-by-default, all running as `awcms_worker`.
  - Removing a permission that no longer has an endpoint prevents the inverse **latent-authz trap**: a permission that is seeded but means nothing.
- **Negative / accepted trade-offs:**
  - **The `awcms_audit_events` audit trail for these two actions is gone.** This is a real cost and it is not hidden. The reason: `recordAuditEvent` is **tenant-scoped**, whereas these actions are global — the old audit row landed in the log of whichever tenant's owner happened to press the button, which is misleading (it implies the action belongs to that tenant), and is invisible to the other tenants that were actually affected too. `idn-regions:import` already writes no audit for the same reason.
    What remains as evidence: the `status`/`activated_at`/`activated_by` columns on `awcms_idn_region_datasets` themselves (the transition history lives in the data row), plus CLI/CI execution logs. A correct cross-tenant audit needs a global log that does not exist in this base yet — recorded as a follow-up, not claimed as done.
  - **A breaking API contract change**: two paths disappear from OpenAPI. Accepted because there are **zero consumers** — no screen in this repo calls them, `awcms-astro` has no admin screens at all yet, and a repo search finds no caller.
  - Activation now requires shell access to the deployment, not a browser. That is the point.
- **Neutral:**
  - `dataset.read` and `region.read` are unchanged — region lookup and the dataset version list remain ordinary tenant endpoints.
  - If a platform operator screen is genuinely needed later, ADR-0051 §Decision already sets its conditions (a platform-scoped gate, outside the tenant catalogue). This ADR does not stand in its way — it only refuses to ship the surface before the gate exists.

## Alternatives considered

- **A machine-credential gate** — rejected; see §Context. It requires widening ADR-0049's read-only allow-list and would let a leaked build token swap the global dataset.
- **A `PLATFORM_SCOPED_ACTIONS` deny-list at the chokepoint guard** — rejected. The permission still appears to be held by the owner while always being denied; that is exactly the "action nobody can ever use" shape that this repo treats as a trap, and it adds a branch to the authorization chokepoint for the sake of one module.
- **Just revoke the permissions, leave the endpoints** — rejected. An endpoint that always 403s by design is dead surface that still has to be maintained, documented, and scanned — and the next reader will "fix" it by re-seeding its permissions.
- **Build the platform-operator concept now** — deferred, not rejected. It is a new authorization primitive (a subject, a way to log in, interaction with RLS and the decision log) that deserves its own ADR. Deferring it does **not** leave the hole open, because the decision above already closes it.
