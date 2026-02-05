# AWCMS Wiki

**Repository:** `github.com/ahliweb/awcms`

AWCMS (**AhliWeb Content Management System**) is an **enterprise-grade, multi-tenant CMS** with **ABAC security** and a **Supabase-backed** architecture. The monorepo hosts multiple clients (Admin, Public, Mobile, IoT) plus extensions and backend migrations.

---

## Overview

**AWCMS Monorepo** provides a unified workspace for building and operating a modern CMS platform:

* **Admin panel** for tenant administrators and platform operators
* **Public portal** for tenant websites / landing pages (Astro + React)
* **Mobile client** (Flutter)
* **IoT client** (ESP32 firmware)
* **Extensions** to add modular features
* **Supabase** backend: Postgres + RLS policies + Edge Functions + migrations

### What “enterprise-grade” implies (practical interpretation)

In this repo context, “enterprise-grade” usually implies:

1. **Tenant isolation** (data separation and least-privilege)
2. **Policy-driven access** (ABAC + RLS)
3. **Auditable operations** (logs, traceability)
4. **Modularity** (extensions + templates)
5. **Operational readiness** (CI/CD, env management, predictable deployments)

---

## Monorepo Layout

From the repository README:

| Directory               | Description                   | Stack                                  |
| ----------------------- | ----------------------------- | -------------------------------------- |
| `awcms/`                | Admin Panel                   | React **19.2.4**, Vite **7.2.7**, Supabase |
| `awcms-public/primary/` | Public Portal                 | Astro **5.12.9**, React **19.2.4**         |
| `awcms-mobile/primary/` | Mobile App                    | Flutter                                |
| `awcms-esp32/primary/`  | IoT Firmware                  | ESP32, PlatformIO                      |
| `awcms-ext/`            | External Extensions           | JavaScript modules                     |
| `supabase/`             | Migrations and Edge Functions | Supabase CLI                           |

**Also present** in the repository (visible in the root listing):

* `docs/` (documentation folder)
* `awcms-mcp/` (MCP integration workspace)

---

## Core Concepts

### Multi-tenancy

Multi-tenancy means **one platform serves many tenants** (organizations, schools, agencies, businesses), each isolated by `tenant_id`.

Common patterns you’ll see (or want to enforce) in an AWCMS-style system:

* Every tenant-scoped table includes `tenant_id`
* Auth/session includes `tenant_id` context (selected tenant)
* Policies prevent cross-tenant reads/writes
* Shared/global tables use `tenant_id IS NULL` or separate schemas

**Implementation baseline (recommended):**

* Enforce `tenant_id` NOT NULL for tenant tables
* Index `(tenant_id, id)` for high-cardinality access
* Use **Supabase RLS** as the final enforcement layer

### ABAC + RLS

**ABAC (Attribute-Based Access Control)**: access decisions depend on attributes such as:

* subject attributes: user role, staff_level, employment status
* object attributes: tenant_id, module_id, resource classification
* environment attributes: time, IP range, device trust
* action attributes: read/create/update/delete/approve

**RLS (Row Level Security)**: Postgres policies that restrict which rows a user can select/insert/update/delete.

**Common combined approach:**

1. Frontend checks (UX convenience)
2. API/Edge Function checks (business logic)
3. Database RLS (hard security boundary)

**Practical example (conceptual):**

* A user can edit a page **only if**:

  * the page is in the same `tenant_id`, and
  * the user has a policy attribute like `can_edit_pages = true`, and
  * (optional) the page is not “locked” by workflow state

### Audit Log

“Audit-log” topic suggests the platform aims to record:

* who did what (user_id)
* when (timestamp)
* on which tenant (tenant_id)
* against what resource (table, row id)
* before/after changes (diff or snapshot)

**Recommended audit log minimum:**

* INSERT/UPDATE/DELETE tracked for sensitive tables
* workflow events tracked (approve/reject/publish)
* authentication events tracked (login/logout/token refresh)

### Workflow Engine

A “workflow-engine” topic typically indicates:

* draft → review → approve → publish
* role-based approvals (staff levels)
* state machine: allowed transitions

**Simple workflow state machine example:**

* `DRAFT` → `IN_REVIEW` → `APPROVED` → `PUBLISHED`
* `IN_REVIEW` → `REJECTED` → `DRAFT`

---

## Getting Started

### Prerequisites

Recommended baseline tooling:

* Node.js (LTS) + npm/pnpm
* Git
* Supabase CLI (for local DB + migrations)
* Docker (optional but helpful for local Supabase)
* Flutter SDK (for `awcms-mobile/primary`)
* PlatformIO (for `awcms-esp32/primary`)

### Quick Start (baseline)

The README points to a **Developer Setup Guide** and per-client guides. If you’re starting without reading those yet, this baseline workflow usually works:

1. **Clone**

   * `git clone <repo>`
2. **Admin app**

   * `cd awcms`
   * `npm install`
   * configure env (Supabase URL + anon key)
   * `npm run dev`
3. **Public portal**

   * `cd awcms-public/primary`
   * `npm install`
   * configure env (tenant slug, public API keys)
   * `npm run dev`
4. **Local Supabase** *(if supported by repo)*

   * `supabase start`
    * apply migrations / seed

---

## Apps & Packages

### Admin Panel (`awcms/`)

**Purpose:** Tenant administration + platform administration.

**Stack:** React 19.2.4 + Vite 7.2.7 + Supabase.

Typical capabilities you’d expect in an admin panel for a multi-tenant CMS:

* Tenant management (create/activate/config)
* User & role management
* Permissions and ABAC policy editor
* Content modules (pages, posts, media)
* Plugin/extension registry
* Logs & audit views
* Localization (multi-language)
* Theme management (light/dark)

**Recommended admin UX standards:**

* Consistent layout grid (sidebar/header/footer)
* Searchable navigation
* Role-aware menu rendering
* Defensive empty states and error boundaries

### Public Portal (`awcms-public/primary/`)

**Purpose:** Tenant-facing website template(s).

**Stack:** Astro 5.12.9 + React 19.2.4.

Typical structure:

* Tenant slug routing (e.g., `/tenant-slug/...`)
* Content fetched from Supabase (public views)
* Static generation / hybrid rendering
* SEO primitives (meta, sitemap, OpenGraph)

### Mobile App (`awcms-mobile/primary/`)

**Purpose:** Mobile-first access to tenant content, dashboards, or operational workflows.

**Stack:** Flutter.

Common use cases:

* staff dashboards
* approvals/review workflows
* offline-friendly forms
* push notifications (if configured)

### IoT Firmware (`awcms-esp32/primary/`)

**Purpose:** ESP32-based device integration.

**Stack:** ESP32 + PlatformIO.

Common patterns:

* provision device → associate with tenant
* publish telemetry to an endpoint
* receive configuration updates

### Extensions (`awcms-ext/`)

**Purpose:** Modular external features.

**Stack:** JavaScript modules.

Recommended extension contract:

* manifest (name/version/permissions)
* capability declaration (what the plugin can do)
* safe sandbox boundaries (no direct DB secrets)

### MCP Integration (`awcms-mcp/`)

**Purpose:** Typically used to integrate AI tooling via **Model Context Protocol (MCP)**.

Likely responsibilities:

* provide structured “tools” for the CMS
* controlled read/write operations
* policy-aware data retrieval

> Keep this layer locked down: MCP tools must not bypass ABAC/RLS boundaries.

---

## Backend (Supabase)

The `supabase/` directory is the home for:

* **SQL migrations** (schema, policies, seeds)
* **Edge Functions** (API-like server logic)

**Recommended backend structure (if not already):**

* `supabase/migrations/` — schema changes
* `supabase/functions/` — edge functions
* `supabase/seed.sql` or `seed/` — initial data

### Database design baseline

For multi-tenant CMS + ABAC, typical core tables:

* `tenants`
* `users` (or mapped from Supabase auth)
* `roles`, `permissions`, `policies`
* `resources` (pages, posts, media)
* `audit_logs`
* `workflow_states`, `workflow_events`

### RLS baseline rules

* deny-by-default
* allow only within same `tenant_id`
* enforce “action” rules (update vs read)

---

## Security Practices

### Minimum hardening checklist

1. **Enable RLS on all tenant tables**
2. **No client-side secrets** (use anon key only on web clients)
3. **Edge Functions for privileged operations**
4. **Audit trails** for admin and approval actions
5. **Content sanitization** (XSS defenses)
6. **Rate-limiting** on public endpoints (Cloudflare/Supabase)

### Mapping to common standards (optional but useful)

If you want AWCMS to be “compliance-friendly,” a practical mapping:

* ISO/IEC 27001/27002: access control, logging, change management
* ISO/IEC 27005: risk assessment for tenant isolation
* ISO/IEC 27017/27018: cloud + privacy controls
* ISO/IEC 27701: privacy information management
* ISO/IEC 22301: continuity (backup/restore, DR)
* ISO/IEC 20000: service management (incident/change)
* ISO/IEC 27034: application security lifecycle
* ISO/IEC 15408 (Common Criteria): security target thinking for critical modules

> Add these mappings only where you can evidence controls in code + ops.

### Indonesian regulation notes (optional)

For deployments serving Indonesian institutions:

* Align data protection practices to **UU PDP (Law No. 27/2022)** principles.
* For electronic systems, consider **PP 71/2019** (PSTE).
* For government deployments, ensure governance and security baselines match agency requirements.

---

## Deployment Patterns

Common deployment options for this stack:

* **Admin (React/Vite):** static hosting + API via Supabase (Cloudflare Pages is a natural fit)
* **Public (Astro):** static/hybrid hosting (Cloudflare Pages / similar)
* **Supabase:** managed or self-hosted (if governance requires)
* **Mobile (Flutter):** Play Store / internal distribution
* **ESP32:** OTA update pipeline (optional)

### Environment management baseline

Keep separate environments:

* `dev` (local)
* `staging`
* `prod`

And separate Supabase projects per environment.

---

## Contributing & Governance

The repository includes:

* `CONTRIBUTING.md`
* `CODE_OF_CONDUCT.md`
* `SECURITY.md`
* `LICENSE`

**Recommended contribution flow:**

1. Create a branch per feature/fix
2. Add tests (where applicable)
3. Update docs in `docs/` and `DOCS_INDEX.md`
4. Submit PR with clear scope and screenshots for UI

---

## Troubleshooting

### 1) Supabase keys are set but auth fails

* Verify you’re using the **anon key** in web clients
* Ensure redirect URLs are set in Supabase auth settings
* Check RLS policies for `auth.uid()` behavior

### 2) Cross-tenant data appears (critical)

* Confirm every tenant table has `tenant_id`
* Confirm RLS policies always filter `tenant_id`
* Remove any “service role” usage from the client

### 3) Build fails on React 19 / Vite 7.x

* Verify Node LTS
* Ensure dependencies support React 19
* Replace outdated UI libs (slideshow, etc.) if incompatible

### 4) Public portal pages not found

* Verify tenant slug routing rules
* Confirm content exists and is “published”
* Confirm public views or policies allow reads

### 5) ESP32 cannot connect

* Confirm Wi‑Fi creds/provisioning
* Confirm API endpoint and TLS settings
* Add device-level auth token and rotate periodically

---

## Roadmap Checklist

Use this as a living checklist:

* [ ] Formalize tenant isolation guarantees (schema + RLS + tests)
* [ ] Formalize ABAC policy model (attributes + evaluation)
* [ ] Add audit log coverage for all privileged actions
* [ ] Document workflow state machine(s)
* [ ] Add extension manifest + permissioning
* [ ] Add CI checks (lint, typecheck, migration verification)
* [ ] Add threat model (STRIDE) and risk register (ISO 27005 style)

---

## Glossary

* **Tenant:** A customer/org using the platform.
* **ABAC:** Attribute-based access control.
* **RLS:** Row Level Security in Postgres.
* **Edge Function:** Server-side logic in Supabase.
* **Workflow:** State machine for content lifecycle.
* **Extension:** Modular add-on feature.
* **MCP:** Model Context Protocol integration for AI tooling.

---

## Next steps to refine this wiki

1. Make `DOCS_INDEX.md` the authoritative navigation.
2. Copy the content of the Developer Setup Guide + client guides into dedicated sections.
3. Add architecture diagrams (tenant boundary, request flow).
4. Add a “Database & RLS Policies” section with real table/policy names.
5. Add a “Release & Versioning” section aligned with `CHANGELOG.md` (if present).
