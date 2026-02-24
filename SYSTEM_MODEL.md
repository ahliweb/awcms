# AWCMS System Model (Authoritative Source of Truth)

> **Status:** ACTIVE
> **Last Updated:** 2026-02-24 (Audited against `package.json`, migration status, and MCP topology)

This document serves as the single source of truth for the AWCMS architecture, technology stack, and security mandates. All Agents (Coding, Communication, Public Experience) must adhere strictly to these definitions.

---

## 1. Technology Stack Mandates

Agents must respect these exact versions to ensure compatibility across the monorepo.

### 1.1 Admin Panel (`awcms`)

* **Framework:** React 19.2.4 (Functional Components Only)
* **Build Tool:** Vite 7.2.7
* **Language:** JavaScript (ES2022+)
* **Styling:** TailwindCSS 4.1.18 (CSS-based config)
* **State Management:** React Context + Hooks (No Redux/Zustand unless specified)
* **Backend Interface:** `@supabase/supabase-js` v2.93.3
* **Routing:** React Router DOM 7.10.1
* **Key Libraries:**
  * UI: `shadcn/ui` (Radix Primitives + Tailwind)
  * Editor: `@puckeditor/core` v0.21.0 (Puck + Render)
  * Rich Text: `tiptap` v3.13.0
  * Motion: `framer-motion` v12.23.26
  * Maps: `leaflet` v1.9.4 + `react-leaflet`

### 1.2 Public Portal (`awcms-public`)

* **Meta-Framework:** Astro 5.17.1
* **Interactive Islands:** React 19.2.4
* **Language:** TypeScript 5.x / TSX
* **Styling:** TailwindCSS 4.1.18 (Vite Plugin)
* **Backend Interface:** `@supabase/supabase-js` v2.93.3
* **Node.js Requirement:** >= 22.12.0 (required by OpenClaw CLI)
* **Rendering Model:** Static output (`output: "static"`) with React islands
* **Sovereign Instances (Level 0):** For multi-national scale, distinct Supabase projects are used per region/country to ensure data sovereignty.
* **Logical Regions (Global):** 10-level operational hierarchy (`regions`) for business segmentation.
* **Administrative Regions (Indonesia):** Standard government hierarchy (`administrative_regions`, `cahyadsn/wilayah`) for legal/compliance.
* **Extensions:** Custom PostgreSQL extensions (`pga_...`) handle complex logic.
* **Constraints:**
  * **NO** direct database access (Must use Supabase JS Client or Edge Functions).
  * **NO** Puck Editor Runtime (Use `Render` from `@puckeditor/core` only).

### 1.3 Backend & Database

* **Platform:** Supabase (PostgreSQL 17)
* **Logic Layer:** PostgreSQL Functions (PL/pgSQL) + Edge Functions (Deno/TS).
* **Node.js Servers:** **FORBIDDEN**. All backend logic must reside in Supabase.

### 1.4 AI Gateway (OpenClaw)

* **CLI:** OpenClaw v2026.2.21-2 (installed globally via npm)
* **Node.js:** >= 22.12.0 (Active LTS)
* **Config:** `~/.openclaw/openclaw.json` (multi-agent routing)
* **Mode:** Per-tenant isolation — each AWCMS tenant maps to an OpenClaw agent with a separate workspace
* **Security:** Token auth, rate limiting (10 attempts/60s, 5min lockout), loopback-only binding
* **Project Config:** `openclaw/openclaw.json` (version-controlled, token excluded)
* **Context7 ID:** `openclaw/openclaw`

### 1.5 MCP Topology (Developer Tooling)

* **Primary Config (Repo):** `mcp.json`
* **Runtime Config (OpenCode):** `~/.config/opencode/opencode.json`
* **Connected Servers (authoritative baseline):**
  * `context7` (remote)
  * `supabase` (local `awcms-mcp` server)
  * `stitch` (local proxy)
  * `github` (local Docker-backed `github/github-mcp-server`)
  * Cloudflare managed remote MCPs: `cloudflare-api`, `cloudflare-docs`, `cloudflare-bindings`, `cloudflare-observability`, `cloudflare-builds`, `cloudflare-radar`, `cloudflare-browser`
* **GitHub Auth Pattern:** token-based local runtime via `GITHUB_PERSONAL_ACCESS_TOKEN` (or equivalent mapped vars).

---

## 2. Architectural Pillars

### 2.1 Multi-Tenancy & Isolation

* **Tenancy Model:** Logical isolation on a shared schema.
* **Mandatory Column:** Every tenant-scoped table **MUST** have a `tenant_id` (UUID) column.
* **Context:**
  * **Admin:** Resolved via `useTenant()` hook.
  * **Public:** Static builds resolve tenant via build-time env (`PUBLIC_TENANT_ID` or `VITE_PUBLIC_TENANT_ID`); middleware resolution is reserved for SSR/runtime deployments.
* **RLS (Row Level Security):**
  * **Strict Enforcement:** RLS must be enabled on ALL tables.
  * **Bypass Rule:** NEVER bypass RLS in client code. Only `supabaseAdmin` (Service Role) in Edge Functions is permitted to bypass, and only for specific administrative tasks.
* **Resource Sharing:**
  * **Shared:** `settings`, `branding`, `modules` (Configurable inheritance).
  * **Isolated:** `users`, `content`, `media`, `commerce` (orders, products).

### 2.2 Data Integrity & Lifecycle

* **Soft Delete:**
  * **Mechanism:** Tables must have a `deleted_at` (TIMESTAMPTZ) column.
  * **Operation:** `DELETE` SQL commands are forbidden for business data. Use `UPDATE table SET deleted_at = NOW()`.
* **Filtering:** All read queries must filter `.is('deleted_at', null)`.
* **Foreign Keys:**
  * Must use `ON DELETE RESTRICT` or `ON DELETE SET NULL` to prevent accidental cascades, supporting the Soft Delete pattern.

* **Admin-Only Profile Data:**
  * Stored in `public.user_profile_admin` with pgcrypto encryption.
  * Passphrase is derived from `user_profiles.description` + per-user salt and re-keyed on description changes.

### 2.3 Permissions (ABAC)

* **Model**: Attribute-Based Access Control (ABAC) via `permissions` table.
* **Roles**: 10-level Staff Hierarchy (See [HIERARCHY.md](docs/tenancy/HIERARCHY.md)).
* **Format**: `scope.resource.action` (e.g., `tenant.blog.create`).
* **Assignment**: `role_permissions` join table.
* **Reference**: See [AGENTS.md](AGENTS.md) for enforcement patterns.

  * Frontend: `usePermissions().hasPermission('...')`
  * Database: `auth.has_permission('...')` in RLS policies.

* **Standard Roles:**
  * **Platform:** Owner, Super Admin.
  * **Tenant:** Admin, Auditor (read-only), Editor, Author, Member, Subscriber, Public, No Access.

### 2.4 Styling & Theming

* **System:** TailwindCSS v4 with CSS Variables.
* **Constraint:** **NO** hardcoded hex values (e.g., `bg-[#123456]`) in components. Use semantic variables (`bg-primary`, `text-foreground`) to support white-labeling and dark mode.

### 2.5 Content Import & Sanitization

* **Stitch Import Policy:** Tenant-controlled via `settings.key = 'stitch_import'`.
* **Config Surface:** `enabled`, `mode`, `max_input_kb`, `allow_raw_html_fallback`.
* **Import Modes:**
  * `html`: single sanitized block import.
  * `mapped`: structured block mapping with optional `RawHTML` fallback.
* **Sanitization Enforcement:**
  * Admin import sanitization in `awcms/src/lib/stitch/sanitizeStitchHtml.js`.
  * Admin fallback rendering sanitization in `awcms/src/utils/sanitize.js`.
  * Public fallback rendering sanitization in `awcms-public/primary/src/utils/sanitize.ts` via `PuckRenderer`.

---

## 3. Directory Structure Standards

* `src/components/ui/`: Generic, reusable primitives (Buttons, Inputs).
* `src/components/[feature]/`: Feature-specific business logic.
* `src/hooks/`: Custom React hooks for data fetching and state.
* `src/lib/`: Stateless utilities and configuration.
* `supabase/migrations/`: SQL migration files (Timestamped).

---

## 4. Documentation Authority

* **Primary:** `SYSTEM_MODEL.md` (This file).
* **Agent Guide:** `AGENTS.md`.
* **Architecture:** `docs/architecture/*.md`.
* **Tenancy:** `docs/tenancy/*.md`.
* **AI Gateway:** `openclaw/openclaw.json`.

Any deviation from this model requires an explicit update to this document.
