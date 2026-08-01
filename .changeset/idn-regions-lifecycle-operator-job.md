---
"awcms": major
---

**Security / breaking:** region-dataset activation and rollback become operator jobs; their HTTP endpoints are removed and their permissions revoked.

`POST /api/v1/idn-regions/datasets/{id}/activate` and `POST /api/v1/idn-regions/datasets/rollback` both swapped the Indonesia administrative-region dataset served to **every** tenant — those tables are global, with no `tenant_id` and no RLS. But `sql/081` seeded their permissions (`idn_admin_regions.dataset.configure` / `.restore`) into the **global** ABAC catalogue, and `POST /api/v1/setup/initialize` grants the whole catalogue to each new tenant's `owner` role. So an ordinary tenant owner held authority over data served to other tenants, and ABAC could not see anything wrong: it evaluates the permission, not who the action ultimately affects.

Replaced by `bun run idn-regions:activate -- --dataset <code|uuid>` and `bun run idn-regions:rollback`, both dry-run by default and writing only with `--commit`, running as `awcms_worker`. This matches `bun run idn-regions:import`, which ADR-0046 §5 had already made job-only for the identical reason: a global action has no request-time tenant subject for an ABAC guard to evaluate.

`sql/084` revokes both permissions and any role grants that already reference them. Two permissions remain for this module, both genuinely read-only: `region.read` and `dataset.read`.

**Breaking:** two OpenAPI paths are removed. No consumer existed — no screen in this repo called them, and a repo-wide search found no caller.

**Accepted cost, stated rather than hidden:** these actions no longer write an `awcms_audit_events` row. That table is tenant-scoped while the action is global; the old row landed in whichever tenant's log the clicking owner belonged to, misrepresenting a global change as that tenant's and staying invisible to every other affected tenant. Evidence now lives on the dataset row itself (`status`, `activated_at`, `activated_by`) plus the command's own output. A correct cross-tenant audit needs a global log this base does not have yet.

See ADR-0052.
