---
name: awcms-abac-guard
description: Terapkan kontrol akses RBAC+ABAC default-deny plus RLS pada endpoint/service AWCMS. Gunakan pada setiap endpoint non-public dan setiap akses data tenant-scoped. Menegakkan default deny, deny-overrides-allow, decision log, dan tenant isolation sesuai doc 03 & 10.
---

# AWCMS — ABAC Guard & Tenant Isolation

Ikuti `docs/awcms/03_srs_detail_per_modul.md`, `docs/awcms/10_template_kode_coding_standard.md`, dan **`docs/awcms/17_default_seed_rbac_abac.md`** (matriks role→permission & default ABAC policy). Mekanisme RLS/tenant context konkret: `docs/awcms/16_backend_data_access_integration.md`.

## Prinsip

1. **Default deny** — tidak ada policy yang mengizinkan = tolak.
2. **Deny overrides allow** — satu deny mengalahkan semua allow.
3. **RLS tetap wajib** walau ABAC sudah cek (defense in depth).
4. Akses ditolak yang high-risk → catat di decision log.
5. UI hiding **bukan** kontrol utama; backend tetap validasi.
6. Archive/restore/purge soft delete default deny sampai permission eksplisit tersedia.

## Bentuk request/decision

```ts
type AccessRequest = {
  moduleKey: string;
  activityCode: string;
  action:
    | "read"
    | "create"
    | "update"
    | "delete"
    | "post"
    | "cancel"
    | "approve"
    | "export"
    | "send"
    | "configure"
    | "analyze"
    | "assign"
    | "restore"
    | "purge"
    | "retry"
    | "sync"
    | "enable"
    | "disable"
    | "check"
    | "publish"
    | "schedule"
    | "archive"
    | "verify"
    | "set_primary" // Issue #562 (tenant_domain) — see access-control.ts's own comment for why neither is in HIGH_RISK_ACTIONS
    | "connect"
    | "disconnect" // Issue #643 (social_publishing) — unlike verify/set_primary, BOTH are in HIGH_RISK_ACTIONS (write a credential-bearing token_reference)
    | "preview" // Issue #641 (blog_content) — read-only (internal-links preview), not in HIGH_RISK_ACTIONS
    // Platform-evolution epic #738 additions (identity-access/domain/access-control.ts:73-188):
    | "release" // #745 data_lifecycle: legal_hold.release — HIGH_RISK
    | "replay" // #742 domain_event_runtime: deliveries.replay — not high-risk (idempotent by event ID)
    | "manage" // #742 domain_event_runtime: consumers.manage (pause/resume) — not high-risk
    | "revoke" // #746 identity-access: business-scope/SoD-exception revoke — HIGH_RISK
    | "override" // #746 identity-access: reserved for future conflict-override hook — HIGH_RISK
    | "reject" // #746 identity-access: reject a SoD conflict exception request — not high-risk (safe outcome)
    | "retire" // #747 workflow_approval: voluntary definition retirement — HIGH_RISK
    | "reassign" // #747 workflow_approval: reassign a pending task's open seats — HIGH_RISK
    | "force_decide" // #747 workflow_approval: force-approve/reject bypassing quorum — HIGH_RISK
    | "merge" // #748 profile_identity: profile_merge.merge (execute approved merge) — HIGH_RISK
    | "commit" // #750 reference_data imports.commit / #751 document_infrastructure number-sequence commit — HIGH_RISK
    | "rollback" // #750 reference_data: imports.rollback — HIGH_RISK
    | "void" // #751 document_infrastructure: irreversible-by-default document void — HIGH_RISK
    | "reclassify" // #751 document_infrastructure: change document classification/confidentiality — HIGH_RISK
    | "reserve" // #751 document_infrastructure: document number sequence reservation — HIGH_RISK
    | "rebuild"; // #753 reporting: trigger/resume a full projection rebuild — HIGH_RISK
  resourceType?: string;
  resourceId?: string;
  resourceAttributes?: Record<string, unknown>;
  environmentAttributes?: Record<string, unknown>;
};
type AccessDecision = {
  allowed: boolean;
  reason: string;
  decisionId?: string;
  matchedPolicy?: string;
};
```

## Prosedur

```mermaid
flowchart LR
  Req[Request] --> Ctx[Tenant context + SET app.current_tenant_id] --> Eval[Evaluate ABAC] --> D{allowed?}
  D -- Tidak --> Log[Decision log jika high-risk] --> Deny[403 ACCESS_DENIED]
  D -- Ya --> Next[Lanjut ke validasi/service]
```

## Aturan implementasi

- Set tenant context di **awal** transaction: `SET app.current_tenant_id = ...`.
- Query tenant-scoped **wajib** filter `tenant_id` (jangan hanya andalkan RLS).
- Query resource soft-deletable default `deleted_at IS NULL`; `includeDeleted`, `restore`, dan `purge` wajib ABAC eksplisit.
- Contoh batas peran: operator ditolak akses pajak/export/assign role; cross-tenant selalu blocked.
- `tenantUserId`/`identityId` berasal dari auth middleware, **bukan** header public mentah.

## Verifikasi (test)

- default deny; deny overrides allow; cashier limit; tax officer access; cross-tenant blocked; archive/restore denied tanpa permission; decision log tercatat.
