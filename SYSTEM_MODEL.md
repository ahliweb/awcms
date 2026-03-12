# AWCMS System Model (Authoritative Source of Truth)

> **Status:** ACTIVE
> **Last Updated:** 2026-03-12 (Audited against `package.json`, migration status, scripts, MCP topology, and current documentation planning refresh)

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
  * **NO** direct database access (Must use Supabase JS Client or approved server-side edge runtimes).
  * **NO** Puck Editor Runtime (Use `Render` from `@puckeditor/core` only).

### 1.3 Backend & Database

* **Platform:** Supabase (PostgreSQL 17), Cloudflare (Workers & R2)
* **Logic Layer:** PostgreSQL Functions + Cloudflare Workers.
* **Node.js Servers:** **FORBIDDEN**. Core authorization truth remains in Supabase; edge HTTP orchestration may run in Cloudflare Workers.
* **Gateway Pattern:** Cloudflare Workers in `awcms-edge/` act as the server-side HTTP gateway for web, mobile, IoT, and other client applications when a request requires privileged orchestration, external integrations, storage signing, or edge-side request shaping.
* **Supabase Authority:** Supabase remains the source of truth for Auth, PostgreSQL data, tenant isolation, Row Level Security (RLS), and ABAC permission enforcement. Cloudflare Workers must not replace or weaken those controls.

### 1.4 AI Gateway (OpenClaw)

* **CLI:** OpenClaw v2026.2.21-2 (installed globally via npm)
* **Node.js:** >= 22.12.0 (Active LTS)
* **Config:** `~/.openclaw/openclaw.json` (multi-agent routing)
* **Mode:** Per-tenant isolation — each AWCMS tenant maps to an OpenClaw agent with a separate workspace
* **Security:** Token auth, rate limiting (10 attempts/60s, 5min lockout), loopback-only binding
* **Project Config:** `openclaw/openclaw.json` (version-controlled, token excluded)
* **Context7 ID:** `openclaw/openclaw`

### 1.5 Self-Hosted AI Models (Ollama)

* **Runtime:** [Ollama](https://ollama.com) — run open-source LLMs locally
* **API:** OpenAI-compatible `/v1/chat/completions` endpoint at `http://localhost:11434/v1/`
* **Recommended Models:** `qwen3` (tool calling + reasoning), `llama3.2` (general purpose)
* **Capabilities:** Chat completions, streaming, tool calling (single + parallel), JSON mode, vision
* **Integration:** Point the OpenAI SDK or OpenClaw `baseUrl` to `http://127.0.0.1:11434/v1`
* **Node.js SDK:** `ollama` npm package (native client) or standard `openai` SDK with custom `baseURL`
* **Multi-Tenancy:** Ollama is stateless; tenant isolation is managed at the OpenClaw Gateway layer
* **Architecture Doc:** [docs/architecture/ollama-integration.md](docs/architecture/ollama-integration.md)

### 1.6 MCP Topology (Developer Tooling)

* **Primary Config (Repo):** `mcp.json`
* **Runtime Config (OpenCode):** `~/.config/opencode/opencode.json`
* **Connected Servers (authoritative baseline):**
  * `context7` (remote)
  * `supabase` (local `awcms-mcp` server)
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
  * **Bypass Rule:** NEVER bypass RLS in client code. Only approved server-side runtimes using `SUPABASE_SECRET_KEY` may perform privileged operations, and only for explicit administrative tasks.
* **Resource Sharing:**
  * **Shared:** `settings`, `branding`, `modules` (Configurable inheritance).
  * **Isolated:** `users`, `content`, `media`, `commerce` (orders, products).

### 2.2 Data Integrity & Lifecycle

* **Soft Delete:**
  * **Mechanism:** Tables must have a `deleted_at` (TIMESTAMPTZ) column.
  * **Operation:** `DELETE` SQL commands are forbidden for business data. Use `UPDATE table SET deleted_at = NOW()`.
* **Filtering:** All read queries must filter `.is('deleted_at', null)`.
* **Foreign Keys:**
  * Prefer `ON DELETE RESTRICT` or `ON DELETE SET NULL` for core business entities to preserve Soft Delete integrity.
  * `ON DELETE CASCADE` is allowed for join/link tables and non-business associative records when intentional and documented in migrations.

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
  * Database: `public.has_permission('...')` in RLS policies.

* **Standard Roles:**
  * **Platform:** Owner, Super Admin.
  * **Tenant:** Admin, Auditor (read-only), Editor, Author, Member, Subscriber, Public, No Access.

### 2.4 Edge Gateway Responsibilities

* **Client Access Pattern:** Client applications should call Cloudflare Worker routes for privileged server-side flows, integration fan-out, signed storage access, webhook handling, and other edge-managed HTTP operations.
* **Auth Preservation:** Workers must validate the caller through Supabase Auth context before performing protected work.
* **Database Preservation:** Workers may read/write Supabase, but PostgreSQL remains the canonical data plane and all tenant/business data continue to live in Supabase.
* **RLS / ABAC Preservation:** RLS and `public.has_permission(...)` remain the final enforcement layer for tenant isolation and authorization. Worker-side checks are additive guardrails, not replacements.
* **Storage Pattern:** Cloudflare R2 is used for object storage and delivery workflows, while metadata, ownership, tenant scope, and permission checks remain anchored in Supabase.

### 2.5 Styling & Theming

* **System:** TailwindCSS v4 with CSS Variables.
* **Constraint:** **NO** hardcoded hex values (e.g., `bg-[#123456]`) in components. Use semantic variables (`bg-primary`, `text-foreground`) to support white-labeling and dark mode.

### 2.6 Content Sanitization

* **Admin Sanitization Enforcement:** Raw HTML rendered in admin-managed flows must pass through `awcms/src/utils/sanitize.js`.
* **Public Sanitization Enforcement:** Public fallback HTML rendering must pass through `awcms-public/primary/src/utils/sanitize.ts` via `PuckRenderer`.
* **Removed Capability:** Stitch import is no longer part of the canonical product surface or runtime.

---

## 3. Directory Structure Standards

* `src/components/ui/`: Generic, reusable primitives (Buttons, Inputs).
* `src/components/[feature]/`: Feature-specific business logic.
* `src/hooks/`: Custom React hooks for data fetching and state.
* `src/lib/`: Stateless utilities and configuration.
* `supabase/migrations/`: canonical SQL migration files (timestamped).
* `awcms/supabase/migrations/`: mirrored migration path used by CI/admin tooling; must remain synchronized with root migrations.

---

## 4. Documentation Authority

* **Level 1 (Primary):** `SYSTEM_MODEL.md` (this file).
* **Level 2:** `AGENTS.md`.
* **Level 3:** `README.md`.
* **Level 4:** `DOCS_INDEX.md`.
* **Level 5:** module/dev/architecture docs in `docs/**`.
* **AI Gateway Runtime Source:** `openclaw/openclaw.json`.

Any deviation from this model requires an explicit update to this document.
