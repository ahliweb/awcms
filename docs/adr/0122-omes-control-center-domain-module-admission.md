🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0122-omes-control-center-domain-module-admission.id.md)

# ADR-0122 — Admission of the OMES Control Center domain module (`omes_control`)

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decision maker:** ahliweb
- **Extends:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0017](0017-document-infrastructure-module-admission.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md), [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md)
- **Related:** OMES Issue ahliweb/omes#196 (parent epic ahliweb/omes#195, migrated from ahliweb/awcms-one#152); OMES Issue ahliweb/omes#197 (pinned v1 contract consumption); `sql/154_awcms_omes_control_schema.sql`; `sql/155_awcms_omes_control_permissions.sql`; `src/modules/omes-control/`

## Context

The OMES project (AhliWeb's infrastructure automation, host compatibility, and service lifecycle platform) requires an operator-facing web control plane ("Control Center") to manage fleets of host servers, worker enrollments, desired vs observed deployments, operation requests, job queues, health telemetry snapshots, backup recovery points, and execution audit projections.

Per the cross-repository architectural authority boundary established in OMES ADR-0017 and AWCMS ADR-0051/0055/0070:

1. Reusable multi-tenant domain models, administrative schemas, Row Level Security (RLS) policies, RBAC/ABAC permissions, and system-admin screens belong canonically in `ahliweb/awcms`.
2. Downstream reference deployments such as `ahliweb/awcms-one` integrate this functionality through a clean `git subtree pull --prefix=apps/cms awcms main` merge without duplicating canonical logic.
3. OMES host execution remains isolated to OMES pull workers; Hermes Agent owns LLM agent runtime and delegation semantics; AWCMS owns the multi-tenant control plane, authorization, and administrative UI.

This ADR records the admission, schema architecture, and security posture of the `omes_control` domain module into `ahliweb/awcms`.

## Architectural Evaluation (11 Criteria)

1. **Advantages and Disadvantages:**
   - _Advantages:_ Pure isolation in `src/modules/omes-control/`. Adheres strictly to AWCMS modular monolith conventions (`defineModule`). Avoids polluting core foundation tables with infrastructure-specific fields.
   - _Disadvantages:_ Requires maintaining schema migrations and data lifecycle descriptors for eight new tables.
2. **Security:**
   - Every tenant-scoped table enforces `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
   - Access is default-deny, gated by explicit permissions (`omes_control.*`).
   - Runtime uses least-privilege roles (`awcms_app` and `awcms_worker`), never DB superusers.
   - Zero raw secrets in database tables: worker private keys, SSH keys, and provider secrets are prohibited. Only public key metadata, key hashes, and redacted evidence are stored.
3. **Performance:**
   - Every foreign key and tenant lookup column is indexed with composite B-tree indexes (`(tenant_id, ...)`).
   - High-volume tables (`awcms_omes_jobs`, `awcms_omes_health_snapshots`, `awcms_omes_audit_projections`) carry data lifecycle retention descriptors preventing unbounded table growth.
4. **Maintainability:**
   - Uses canonical AWCMS registries: `ModuleDescriptor`, permissions catalogue, `subjectData` / `NO_SUBJECT_DATA`, and `dataLifecycle`.
5. **Scalability:**
   - Multi-tenant partitioning via `tenant_id` and RLS allows seamless scaling across multiple servers and tenants without cross-tenant leakage.
6. **Accessibility:**
   - Navigation and admin screen entry points follow WCAG 2.1 AA and AWCMS design token contrast requirements (`design:token-contrast:check`).
7. **SEO Impact:**
   - None. The module is strictly internal administrative infrastructure within `/admin/*`, authenticated and not indexed.
8. **UI/UX Implications:**
   - Integrates naturally into the existing AWCMS `/admin` sidebar navigation with localized labels and permission gating.
9. **Compatibility:**
   - Uses PostgreSQL 18-compatible DDL, standard UUIDs (`gen_random_uuid()`), and `timestamptz`.
10. **Operational Complexity:**
    - Minimal: uses standard forward-only SQL migrations (`sql/154` and `sql/155`) with no breaking changes to existing tenant data.
11. **Long-Term Technical Implications:**
    - Establishes a durable contract between OMES and AWCMS without blurring operational boundaries.

## Decision

1. **Module Admission:** Register `omesControlModule` under `src/modules/omes-control/module.ts` as a `"domain"` module with key `"omes_control"`.
2. **Schema & Tables:**
   - `awcms_omes_servers`: Fleet inventory and heartbeat timestamps.
   - `awcms_omes_enrollments`: Worker enrollment metadata, public key credentials, and lifecycle status.
   - `awcms_omes_deployments`: Desired vs observed deployment states, drift reconciliation status, and error evidence.
   - `awcms_omes_operation_requests`: Tenant-authorized operation requests with idempotency keys.
   - `awcms_omes_jobs`: Worker job queue and lease tracking.
   - `awcms_omes_health_snapshots`: Point-in-time server health checks and telemetry.
   - `awcms_omes_backup_snapshots`: Backup manifests, sizes, checksums, and verification status.
   - `awcms_omes_audit_projections`: Projection of remote OMES host execution evidence.
3. **RLS & Grants:**
   - All 8 tables carry `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE`.
   - All 8 tables have RLS enabled and forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
   - Tenant isolation policy: `USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`.
   - `SELECT`, `INSERT`, `UPDATE`, `DELETE` granted to `awcms_app` and `awcms_worker`.
4. **Permissions Catalogue:**
   - Seeded in `sql/155_awcms_omes_control_permissions.sql` covering servers, deployments, jobs, backups, audit, and enrollments.
5. **Subject Data & Data Lifecycle:**
   - All 8 tables are operational infrastructure records containing no personal data about natural persons, registered in `NO_SUBJECT_DATA`.
   - High-volume tables declare data lifecycle retention descriptors in the module descriptor.

## Addendum (Issue ahliweb/omes#197): pinned OMES v1 contract consumption

The `omes_control` module needs to validate payloads it exchanges with OMES against the wire contracts OMES itself publishes at `contracts/control-center/v1/**` (OMES issue #89, fail-closed keyword policy from OMES issue #172). Two constraints from the OMES/AWCMS boundary (§1 above) apply directly:

- AWCMS must not fetch these contracts over the network at runtime or test time (no live dependency on the OMES repository being reachable).
- AWCMS must not implement a second, independently-drifting JSON Schema validator with looser semantics than OMES's own — that would let a payload OMES rejects pass on the AWCMS side, or vice versa.

**Decision:** vendor a pinned, byte-identical snapshot rather than fetching or re-deriving the contracts.

- **Vendored snapshot:** `src/modules/omes-control/contracts/v1/` is an exact copy of `contracts/control-center/v1/**` from a pinned OMES commit — every schema, every `*.states.json` state machine, every event schema, and every fixture (including `.reason.txt` reason-class assertions). A `PIN.json` manifest in that directory records the source repository, area, version, the exact 40-character source commit SHA, the sync timestamp, and a SHA-256 hash of every vendored file.
- **Sync/drift tooling:** `scripts/sync-omes-contracts.ts` re-vendors from a local OMES checkout path (`bun run contracts:omes:sync -- --source <path> --commit <sha>`) and, in `--check` mode (`bun run contracts:omes:sync:check`), recomputes hashes and fails loudly on drift, a missing pin, or a version mismatch. `contracts:omes:sync:check` is wired into `bun run check` immediately after `api:consumer-contract:check`, so contract drift is a release gate, not a discovered-in-production surprise.
- **Fail-closed validator, no new dependency:** `src/modules/omes-control/domain/contracts/schema.ts` is a TypeScript port of `lib/omes/py/jobs/schema.py`'s exact supported-keyword allowlist (`type`, `required`, `properties`, `additionalProperties`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `items`, `oneOf`, `anyOf`, plus the `$schema`/`$id`/`title`/`description` annotations) — any other JSON Schema keyword throws rather than being silently ignored. The independent raw-secret scanner (`scanForRawSecrets`) mirrors the same file's secret-name/secret-shape bans and always runs, regardless of what a given schema declares. `const`/`enum` equality uses order-independent deep structural equality (`json-parse.ts`'s `deepEqualJson`), not key-order-sensitive string comparison. All `properties`/`required`/`additionalProperties` lookups against an instance's own keys use `Object.hasOwn`, never the `in` operator or bracket indexing — both resolve a key literally named `__proto__` against the object inherited from `Object.prototype`, not the schema's own declared keys. No `ajv`, `zod`, or other JSON Schema package was added; AWCMS already ships none, matching OMES's own stdlib-only posture (ADR-0012).
- **Raw-text parsing is prototype-pollution-safe:** `validateOmesContractText`'s parser (`json-parse.ts`) builds every object result with `Object.defineProperty`, never `obj[key] = value` — the latter is a textbook prototype-pollution vector for a hand-rolled parser: a key literally named `__proto__` would hit `Object.prototype`'s accessor instead of creating a data property, making the smuggled value invisible to both schema validation and the secret scanner (both walk objects with `Object.keys`/`Object.entries`). The parser's number/string/whitespace grammar is also deliberately no more permissive than native `JSON.parse`/Python `json.loads` (rejects leading zeros, digit-less decimals, a leading BOM, unescaped control characters in strings) and caps nesting depth so adversarial input fails with a clean `JsonParseError` rather than an uncaught stack overflow.
- **State machines as data:** `src/modules/omes-control/domain/contracts/state-machine.ts` is a generic transition checker loaded from the vendored `*.states.json` files (mirroring `lib/omes/py/jobs/states.py`) — the subscription/invoice lifecycle rules live in the pinned JSON, never duplicated as hand-written TypeScript control flow.
- **Unsupported version handling:** every entry point (`validateOmesContract`, `assertOmesContract`, `getOmesStateMachine`) rejects any contract version other than the one vendored (`v1`) before touching disk.
- **Public API:** `src/modules/omes-control/domain/contracts/index.ts` exports `validateOmesContract`, `validateOmesContractText`, `assertOmesContract`, `scanForRawSecrets`, `getOmesStateMachine`, and `OMES_CONTRACT_PIN` for the API/application layer (OMES issues #198/#199) to consume.

**Update procedure:** when OMES publishes a new pinned commit for `contracts/control-center/v1/**` (or a future `v2`), run `bun run contracts:omes:sync -- --source <path-to-omes-checkout> --commit <new-40-char-sha>` from an AWCMS checkout with a local OMES clone available, review the resulting diff under `src/modules/omes-control/contracts/v1/` and the new `PIN.json`, run `bun run check` (which re-validates every fixture and the drift gate), and land the result as its own PR referencing the OMES commit/issue that motivated the re-sync. The vendored snapshot is excluded from Prettier (`.prettierignore`) so re-formatting never disagrees with the pinned upstream bytes.
