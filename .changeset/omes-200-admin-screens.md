---
"awcms": minor
---

feat(control-center): admin screens for overview, servers, deployments, operations and jobs (ahliweb/omes#200)

Adds the five primary OMES Control Center admin screens under `/admin/omes/*`, consuming the owner/operator API (`ahliweb/omes#198`) and built entirely from existing AWCMS admin-shell primitives — `AdminLayout`, `loadAdminScreen`, `admin-screens.css`, `status-badge`, `stat-grid`, keyset-paginated `data-table`, and `admin-form-client` — with no new UI framework or charting dependency:

- **Overview** (`/admin/omes`) — server health distribution, job state summary, backup freshness, and drift summary, aggregated directly from `omes_control` state (never from the `reporting` module's projections). Structured so `ahliweb/omes#201`'s health/backup-recovery/audit screens add sections here without restructuring.
- **Servers** (`/admin/omes/servers`) — fleet inventory plus per-server enrollment/trust evidence (worker status and a SHA-256 public-key fingerprint only, never raw key material). No Hermes-baseline section, because the #198 servers API carries none yet — that belongs to `/api/v1/omes/health` and is `#201`'s to render.
- **Deployments** (`/admin/omes/deployments`) — read-only; desired and observed state render in separate labelled table columns (never merged), with last-reconciliation time, an explicit staleness badge, and error evidence. Changing a deployment routes through Operations.
- **Operations** (`/admin/omes/operations`) — submission limited to the OMES-owned safe-operation allowlist (`status`/`preflight`/`start`/`stop`/`restart`/`update`/`backup`/`rollback`); a destructive option is rendered disabled unless the actor holds its own endpoint permission, and a destructive request's approval decision links into the canonical `/admin/approvals` workflow surface by workflow instance — no second, OMES-specific approval inbox.
- **Jobs** (`/admin/omes/jobs`) — worker dispatch queue: state, correlation (`operationRequestId`), lease ownership, retry count, and sanitized evidence, with approve-for-retry (failed only) and cancel (queued only) actions.

Every mutation is a `fetch` to an already-guarded `#198` endpoint with a fresh `Idempotency-Key`; no screen executes SQL directly, so server-side authorization (the 13 `omes_control` permissions seeded by `sql/155`) remains the sole enforcement point and these screens' visibility checks are UX only. Registers the five navigation entries the `omes_control` module descriptor was missing (closing the "module without navigation" gap `PROJECT_STATE.md` tracked), each gated on one of the already-seeded permissions — no new permission migration.

Cross-tenant scoping decision: none of these five screens' actions cross a tenant boundary — every `omes_control` table carries `tenant_id` under FORCE ROW LEVEL SECURITY (`sql/154`) and every application-layer query scopes on the caller's own `tenantId`. Per ADR-0051 §Keputusan (the ADR-0048 lesson: a permission that is merely seeded to the `owner` role enforces nothing on its own), a platform-scoped gate is required only when an action's *effect* reaches another tenant's data; none here do, so the ordinary tenant-seeded permissions are sufficient and no platform-only permission was added.

Adds `tests/admin-omes-control-page-contract.test.ts` (permission/endpoint/seed parity, no-direct-SQL, idempotency-key discipline, stale/offline rendering, safe-operation allowlist enforcement, approval delegation, static tenant-scoping) and updates `tests/omes-control-module.test.ts`'s navigation assertion now that the physical screens exist. Adds the EN/ID locale catalog entries these screens use.
