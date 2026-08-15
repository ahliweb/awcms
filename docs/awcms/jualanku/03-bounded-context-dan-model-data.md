🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](03-bounded-context-dan-model-data.id.md)

# 03 — Bounded contexts, modules, and the data model

> A plan. See the [README](README.md) for status. None of the tables below exist
> in `sql/` yet.

## 1. Five contexts, not seven

| Module key                  | Owns                                                                                                                                                 | Does **not** own                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `jualanku_directory`        | Merchants, membership, business categories, locations, business pages, publication, the verification-status projection, the merchant scope hierarchy | Product detail, payments, the affiliate ledger                     |
| `jualanku_catalog_growth`   | Products/services, promotions, CTAs, meaningful interactions, leads, analytics source events                                                         | Commission approval and payouts                                    |
| `jualanku_affiliate`        | Affiliate profiles, referral links, attribution, conversions, fraud flags                                                                            | Merchant invoices/subscriptions                                    |
| `jualanku_commercial`       | Plans, entitlements, subscriptions, invoices, the commission ledger, payout requests                                                                 | Gateway settlement (until a provider is chosen)                    |
| `jualanku_trust_operations` | Verification cases, moderation, complaints, appeals, onboarding-agent assignments                                                                    | Generic identity/email/media/audit (the foundation provides those) |

Why not seven: module boundaries follow invariants, data ownership, and change
patterns — not menu structure. Splitting further happens once coupling has been
measured, not before.

## 2. Draft `ModuleDescriptor`

The minimum shape every module uses (final values are fixed at scaffold time; the
repo's `MODULE_CONTRACT_VERSION` when this document was written is `2.4.0`):

```ts
export const jualankuDirectoryModule: ModuleDescriptor = {
  key: "jualanku_directory",
  name: "Jualanku Directory",
  version: "0.1.0",
  status: "experimental",
  type: "domain",
  description:
    "Merchant registry, membership, taxonomy, and public business pages.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "logging"
  ],
  api: {
    openApiPath: "openapi/modules/jualanku-directory.openapi.yaml",
    basePath: "/api/v1/jualanku",
    routes: [
      "/api/v1/jualanku/public/merchants",
      "/api/v1/jualanku/portal/merchant",
      "/api/v1/jualanku/admin/merchants"
    ]
  },
  capabilities: {
    // Fills the scope hierarchy resolver for the `merchant` type (ADR-0030) —
    // without it, high-risk merchant actions deny because `resolved: false`.
    provides: ["business_scope_hierarchy"]
  },
  permissions: [
    { activityCode: "merchant", action: "read", description: "..." },
    { activityCode: "merchant", action: "create", description: "..." },
    { activityCode: "merchant", action: "update", description: "..." },
    { activityCode: "merchant", action: "publish", description: "..." },
    {
      activityCode: "merchant_membership",
      action: "assign",
      description: "..."
    }
  ],
  searchSources: [/* published rows only — see the site_search module */],
  dataLifecycle: [/* high-volume tables + retention classes */]
};
```

Notes that decide whether the gates pass:

- `permissions` in the descriptor does **not** grant permissions to tenants that
  already exist. Every module carries its own **permission seed migration**, and
  deploying to an older tenant needs an `awcms_role_permissions` backfill.
- `routes` declares route ownership (`bun run modules:routes:check`), and only
  the owning module may write its tables
  (`bun run modules:table-writes:check`).
- A module with `capabilities.provides` changes the capability graph, not the
  dependency graph — the DAG stays acyclic.
- Every new domain module needs an **admission ADR** per
  [`../21_module_admission_governance.md`](../21_module_admission_governance.md).

## 3. Table conventions

- Prefix `awcms_jualanku_<context>_<entity>` (e.g.
  `awcms_jualanku_directory_merchants`). The long prefix is chosen so that module
  ownership is readable from the table name, in keeping with this repo's habits.
- Mandatory columns: `id uuid`, `tenant_id uuid NOT NULL`, `created_at timestamptz`,
  `updated_at timestamptz`, and `deleted_at timestamptz` for soft-deleted
  entities.
- **`FORCE` RLS on every tenant-scoped table**, with policies based on the tenant
  GUC.
- FKs between tenant-scoped tables use a **composite FK** `(tenant_id, id)` —
  a plain FK bypasses RLS and becomes a cross-tenant leak path. A table that is
  the target of an FK needs `UNIQUE (tenant_id, id)`.
- Money uses `numeric`, not float. Time uses `timestamptz`.
- The merchant ownership column is named `merchant_id` **in every context**, so
  ownership predicates can be reviewed with a single grep.
- High-volume columns (clicks, interaction events, logs) declare
  `dataLifecycle` and honour legal hold.

Migration numbering follows the next available number at the time the module is
written — do **not** write a concrete number into this document: references to
migration files that do not exist yet are failed by `bun run check:docs`, and an
applied migration is immutable (correct it with a new migration, not an edit).

## 4. Entities per context

### 4.1 `jualanku_directory`

| Table                       | Key columns                                                                                                                                          | Notes                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `..._merchants`             | `slug` (unique per tenant), `display_name`, `legal_name`, `category_id`, `status` (draft/published/suspended), `verification_status`, `published_at` | `legal_name` is not public data.                                            |
| `..._merchant_members`      | `merchant_id`, `identity_id`, `member_role` (owner/editor/analyst), `valid_from`, `valid_until`, `status`                                            | The source of scope grants; unique `(tenant_id, merchant_id, identity_id)`. |
| `..._categories`            | `parent_id`, `slug`, `name`, `position`                                                                                                              | A shared taxonomy across merchants.                                         |
| `..._merchant_locations`    | `merchant_id`, `province`, `city`, `district`, `geo_point`                                                                                           | A high-precision address is restricted data, not public.                    |
| `..._merchant_pages`        | `merchant_id`, `sections jsonb`, `status`, `published_revision_id`                                                                                   | Content blocks use the `blog_content` block vocabulary, not HTML.           |
| `..._merchant_publications` | `merchant_id`, `action` (publish/unpublish), `actor`, `occurred_at`                                                                                  | Append-only; the publication trail.                                         |

The public projection = rows with `status = 'published'` **and** not currently
held by moderation. No free-form queries against draft tables from the public
namespace.

### 4.2 `jualanku_catalog_growth`

| Table                | Key columns                                                                                                        | Notes                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `..._offerings`      | `merchant_id`, `kind` (product/service), `slug`, `name`, `price_amount numeric`, `price_currency`, `status`        | Price comes from the system of record, not page text.    |
| `..._offering_media` | `offering_id`, `media_object_id`                                                                                   | FK into the `media_library` registry; no free-form URLs. |
| `..._promotions`     | `merchant_id`, `offering_id?`, `starts_at`, `ends_at`, `terms`                                                     | Promotional claims go through content review.            |
| `..._leads`          | `merchant_id`, `channel`, `contact_hash`, `contact_masked`, `status`, `occurred_at`                                | Contact PII is hashed + masked, never raw in a list.     |
| `..._interactions`   | `merchant_id`, `interaction_type` (whatsapp_click/call/direction/link), `idempotency_key`, `occurred_at`, `source` | Public ingest; unique on `idempotency_key`.              |

`..._interactions` is the only table that accepts writes from a public surface.
Because of that it is: privacy-minimized (no fingerprint), idempotent, has its own
rate limit, and is never a source of authorization.

### 4.3 `jualanku_affiliate`

| Table             | Key columns                                                                                                                   | Notes                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `..._affiliates`  | `identity_id`, `status` (pending/approved/suspended), `payout_profile_id`                                                     | Affiliate approval is a high-risk action.             |
| `..._links`       | `affiliate_id`, `code` (unique per tenant), `target_type`, `target_id`                                                        | Codes must not be sequentially guessable.             |
| `..._clicks`      | `link_id`, `occurred_at`, `source_hash`                                                                                       | High volume → `dataLifecycle` + rollup.               |
| `..._conversions` | `link_id`, `merchant_id`, `subject_type`, `subject_id`, `status` (pending/held/approved/rejected/reversed), `idempotency_key` | Status transitions are append-only in an event table. |
| `..._fraud_flags` | `conversion_id`, `flag_type` (self_referral/velocity/duplicate_instrument), `raised_by`, `resolved_at`                        | Self-referral is a rule, not an optional heuristic.   |

### 4.4 `jualanku_commercial`

| Table                     | Key columns                                                                                        | Notes                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `..._plans`               | `code`, `name`, `price_amount`, `billing_period`, `status`                                         | Changing a plan = `configure`, audited.                                           |
| `..._plan_entitlements`   | `plan_id`, `entitlement_key`, `limit_value`                                                        | Entitlements are evaluated in the service, not in the UI.                         |
| `..._subscriptions`       | `merchant_id`, `plan_id`, `status`, `current_period_start/end`, `cancel_at`                        | —                                                                                 |
| `..._invoices` / `_lines` | `merchant_id`, `number` (unique per tenant), `status`, `total_amount`                              | An invoice number is never reused.                                                |
| `..._commission_entries`  | `affiliate_id`, `conversion_id`, `entry_type` (accrual/reversal/adjustment), `amount`, `posted_at` | **Append-only**; a correction is a new entry, not an UPDATE.                      |
| `..._payout_requests`     | `affiliate_id`, `amount`, `status`, `requested_by`, `idempotency_key`                              | The _available_ balance is computed from the ledger, not from a conversion total. |
| `..._payout_decisions`    | `payout_request_id`, `decision` (approve/reject), `decided_by`, `decided_at`, `reason`             | Maker ≠ approver (SoD + workflow).                                                |

The rule that cannot be relaxed: **an external provider is never called inside a
database transaction**. Gateway/tax/notification calls go through the outbox +
an idempotency key.

### 4.5 `jualanku_trust_operations`

| Table                        | Key columns                                                                            | Notes                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `..._verification_cases`     | `merchant_id`, `case_type`, `status`, `assigned_to`, `sla_due_at`                      | A merchant cannot approve itself.                                |
| `..._verification_evidence`  | `case_id`, `media_object_id`, `evidence_type`, `masked_summary`                        | Sensitive evidence is masked in responses; access is audited.    |
| `..._moderation_cases`       | `subject_type`, `subject_id`, `reason`, `status`, `decided_by`                         | Hold publication without deleting data.                          |
| `..._complaints`             | `reporter_hash`, `subject_type`, `subject_id`, `status`, `resolution`                  | A complaint channel is mandatory before go-live (Law 8/1999).    |
| `..._appeals`                | `case_id`, `submitted_by`, `status`, `decided_by`                                      | An appeal is decided by someone other than the original decider. |
| `..._onboarding_assignments` | `merchant_id`, `agent_identity_id`, `valid_from`, `valid_until`, `consent_recorded_at` | The source of time-bounded scope grants for onboarding agents.   |

## 5. Table ownership & cross-module communication

- One table = one writing module. Other modules read through an **application
  service**, a **capability port**, a **read model**, or a **domain event** —
  never through a direct join into someone else's table.
- Dependency direction: `commercial` and `affiliate` must **not** depend on
  `catalog_growth`; their relationship goes through events (`conversion.recorded`,
  `subscription.activated`) and read models.
- `directory` provides the merchant scope hierarchy consumed by every other
  Jualanku module — that is the only capability they share.
- Domain events use the existing outbox runtime (`domain_event_runtime`) and are
  declared in AsyncAPI, complete with PII classification, retry, and
  dead-lettering.

## 6. Personal data & retention

| Data class                                   | Treatment                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Bank account number, NIK, NPWP, phone, email | Store normalized + hashed for lookup; display **masked** according to purpose; never in a default list. |
| Verification evidence (documents/images)     | `media_library` + audited access + summary masking; never a public URL.                                 |
| Clicks/interactions/analytics                | Privacy-minimized, no fingerprint, fast aggregation, short retention via `dataLifecycle`.               |
| Commission ledger, invoices, payouts         | Long retention (bookkeeping obligations), append-only, subject to legal hold.                           |
| Complaints & complaint evidence              | Limited retention + legal hold during a dispute.                                                        |

The data-subject request flow (access/rectification/erasure/objection) uses the
existing `data_lifecycle` mechanism; data that must be retained is limited and the
reason is explained to the requester.
