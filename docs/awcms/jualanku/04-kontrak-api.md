🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](04-kontrak-api.id.md)

# 04 — Jualanku API Contract

> Plan. See the [README](README.md) for status. There is not a single
> `/api/v1/jualanku/**` route in this repo yet.

## 1. Three namespaces, one implementation of the rules

```
Public (readable by anyone, no session):
  /api/v1/jualanku/public/**

Self-service portal (called only by the awcms-astro BFF):
  /api/v1/jualanku/portal/merchant/**
  /api/v1/jualanku/portal/affiliate/**

Internal administration (internal role-bearing sessions only):
  /api/v1/jualanku/admin/**

Session (owned by identity_access, not by Jualanku):
  /api/v1/auth/login, /logout, /me, and the new session introspection endpoint
  (see 05-kontrak-sesi-dan-bff.md)
```

All three call the **same application service**. The only differences are:
authentication, authorization, the input surface accepted, and the response
projection. A business rule written twice is a defect, regardless of whether the
two copies currently agree.

## 2. Endpoint inventory (target shape)

### 2.1 Public

| Method & path                                   | Module           | Notes                                                                 |
| ----------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `GET /public/merchants`                         | `directory`      | Keyset pagination; `published` only; no legal/bank account data.      |
| `GET /public/merchants/{slug}`                  | `directory`      | 404 for draft/withheld — not 403.                                     |
| `GET /public/categories`                        | `directory`      | Public taxonomy.                                                      |
| `GET /public/offerings` / `{slug}`              | `catalog_growth` | No checkout in the initial phase.                                     |
| `POST /public/interactions`                     | `catalog_growth` | **Idempotent** (`Idempotency-Key`), rate-limited, minimal data.       |
| `GET /public/affiliate/track/{code}` (redirect) | `affiliate`      | Records the click then redirects; the target is allow-list validated. |

Directory search uses the existing `site_search`, not a new search endpoint.

### 2.2 Merchant portal

| Method & path                                      | Permission (`module.activity.action`)                | Idempotency  |
| -------------------------------------------------- | ---------------------------------------------------- | ------------ |
| `GET /portal/merchant/profile`                     | `jualanku_directory.merchant.read`                   | —            |
| `PATCH /portal/merchant/profile`                   | `jualanku_directory.merchant.update`                 | ETag/version |
| `POST /portal/merchant/publish`                    | `jualanku_directory.merchant.publish`                | mandatory    |
| `GET/POST/PATCH /portal/merchant/offerings`        | `jualanku_catalog_growth.offering.*`                 | ETag/version |
| `GET/POST /portal/merchant/promotions`             | `jualanku_catalog_growth.promotion.*`                | —            |
| `GET /portal/merchant/leads`                       | `jualanku_catalog_growth.lead.read`                  | —            |
| `GET /portal/merchant/analytics`                   | `jualanku_catalog_growth.analytics.read`             | —            |
| `GET /portal/merchant/members` / `POST` / `DELETE` | `jualanku_directory.merchant_membership.assign`      | —            |
| `GET /portal/merchant/subscription` `/invoices`    | `jualanku_commercial.subscription.read`              | —            |
| `POST /portal/merchant/verification`               | `jualanku_trust_operations.verification_case.create` | mandatory    |

### 2.3 Affiliate portal

| Method & path                       | Permission                                  | Idempotency   |
| ----------------------------------- | ------------------------------------------- | ------------- |
| `GET /portal/affiliate/summary`     | `jualanku_affiliate.affiliate.read`         | —             |
| `GET/POST /portal/affiliate/links`  | `jualanku_affiliate.link.*`                 | —             |
| `GET /portal/affiliate/conversions` | `jualanku_affiliate.conversion.read`        | —             |
| `GET /portal/affiliate/commissions` | `jualanku_commercial.commission.read`       | —             |
| `POST /portal/affiliate/payouts`    | `jualanku_commercial.payout_request.create` | **mandatory** |
| `GET /portal/affiliate/payouts`     | `jualanku_commercial.payout_request.read`   | —             |

The balance shown is the **available balance from the ledger** (after the holding
period, reversals, and disputes), not the conversion total.

### 2.4 Internal admin

| Group                                           | Primary permission                                               | Additional controls                    |
| ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `/admin/merchants`, `/admin/verifications`      | `jualanku_directory.merchant.*`, `..._trust_operations.*`        | Step-up for high-risk actions          |
| `/admin/catalog`, `/admin/moderation`           | `jualanku_catalog_growth.*`, `..._trust_operations.moderation.*` | Audit + mandatory reason               |
| `/admin/affiliates`, `/admin/commissions`       | `jualanku_affiliate.*`, `jualanku_commercial.commission.*`       | Reversals carry a reason               |
| `/admin/payouts`                                | `jualanku_commercial.payout_request.approve`                     | **SoD**: creator ≠ approver + workflow |
| `/admin/plans`, `/admin/subscriptions`          | `jualanku_commercial.plan.configure`                             | Price changes are audited              |
| `/admin/reports`, `/admin/risk`, `/admin/audit` | `*.report.read`, `*.export`                                      | Exporting PII = a high-risk action     |

## 3. The binding minimum contract

| Control         | Requirement                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAPI         | One fragment per module in `openapi/modules/`, bundled deterministically (ADR-0026). An endpoint without a fragment fails `bun run api:spec:check`.                                        |
| AsyncAPI        | Every domain event: name, version, producer, consumer, payload, PII classification, retry, dead-letter.                                                                                    |
| Envelope        | Success `{ data, meta }`, failure `{ error: { code, message, correlationId } }` — using `_shared/api-response`.                                                                            |
| Error code      | Stable and meaningful: `VALIDATION_FAILED`, `ACCESS_DENIED`, `MODULE_DISABLED`, `SOD_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`.                                                       |
| Pagination      | Keyset/cursor for every large collection, with a bounded limit. The cursor carries `created_at` as **full-precision text** — Postgres microsecond precision vs JS milliseconds skips rows. |
| Idempotency     | Mandatory for payout, invoice, publish, import, and interaction ingest. The key is stored and the first result is replayed.                                                                |
| Concurrency     | ETag/version optimistic locking for profiles, catalog, and moderation cases.                                                                                                               |
| Audit           | Actor, tenant, resource, action, outcome, correlation ID; sensitive payloads are redacted.                                                                                                 |
| Rate limit      | Different per audience: public search, interaction ingest, login, upload, payout, admin.                                                                                                   |
| Standard header | Security headers via middleware (not `astro.config`), `no-store` for portal/admin.                                                                                                         |

## 4. Domain events

| Event                                    | Producer           | Typical consumers                              |
| ---------------------------------------- | ------------------ | ---------------------------------------------- |
| `jualanku.merchant.published`            | `directory`        | `site_search`, `seo_distribution`, cache purge |
| `jualanku.merchant.verification_decided` | `trust_operations` | `directory` (status projection), `email`       |
| `jualanku.offering.published`            | `catalog_growth`   | `site_search`, cache purge                     |
| `jualanku.interaction.recorded`          | `catalog_growth`   | merchant reporting/read model                  |
| `jualanku.conversion.recorded`           | `affiliate`        | `commercial` (commission accrual)              |
| `jualanku.conversion.reversed`           | `affiliate`        | `commercial` (reversal)                        |
| `jualanku.payout.decided`                | `commercial`       | `email`, reporting, audit                      |
| `jualanku.subscription.changed`          | `commercial`       | `directory` (business page entitlement)        |

Events are the only "automatic" path between contexts. No context writes another
context's tables, not even through a job.

## 5. What is deliberately **not** built in the initial phase

- Marketplace checkout, escrow, wallet, logistics, multi-merchant transactions.
- Its own search endpoint (use `site_search`).
- A second identity system in the portal (use `identity_access`).
- Public endpoints that accept `merchantId` as the determinant of ownership.
- Outbound webhooks to third parties before there is an agreed contract, retry
  policy, and data classification.
