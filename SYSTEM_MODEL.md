# AWCMS System Model (Authoritative Source of Truth)

> **Status:** ACTIVE
> **Last Updated:** 2026-02-07

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
* **Backend Interface:** `@supabase/supabase-js` v2.87.1
* **Routing:** React Router DOM 7.10.1
* **Key Libraries:**
  * UI: `shadcn/ui` (Radix Primitives + Tailwind)
  * Editor: `@puckeditor/puck` v0.21.0
  * Rich Text: `tiptap` v3.13.0
  * Motion: `framer-motion` v12.23.26

### 1.2 Public Portal (`awcms-public`)

* **Meta-Framework:** Astro 5.12.9
* **Interactive Islands:** React 19.2.4
* **Language:** TypeScript 5.x / TSX
* **Styling:** TailwindCSS 4.1.18 (Vite Plugin)
* **Backend Interface:** `@supabase/supabase-js` v2.93.3
* **Constraints:**
  * **NO** direct database access (Must use Supabase JS Client or Edge Functions).
  * **NO** Puck Editor Runtime (Use `PuckRenderer` only).

### 1.3 Backend & Database

* **Platform:** Supabase (PostgreSQL 15+)
* **Logic Layer:** PostgreSQL Functions (PL/pgSQL) + Edge Functions (Deno/TS).
* **Node.js Servers:** **FORBIDDEN**. All backend logic must reside in Supabase.

---

## 2. Architectural Pillars

### 2.1 Multi-Tenancy & Isolation

* **Tenancy Model:** Logical isolation on a shared schema.
* **Mandatory Column:** Every tenant-scoped table **MUST** have a `tenant_id` (UUID) column.
* **Context:**
  * **Admin:** Resolved via `useTenant()` hook.
  * **Public:** Resolved via Middleware (Slug/Host) -> `usePublicTenant()`.
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

### 2.3 Permission System (ABAC/RBAC)

* **Standard Format:** `scope.resource.action`
  * *Examples:* `tenant.blog.publish`, `platform.module.install`.
* **Matrix Enforcement:**
  * Frontend: `usePermissions().hasPermission('...')`
  * Database: `auth.has_permission('...')` in RLS policies.
* **Roles:**
  * **Platform:** Owner, Super Admin.
  * **Tenant:** Admin, Editor, Author, Member.

### 2.4 Styling & Theming

* **System:** TailwindCSS v4 with CSS Variables.
* **Constraint:** **NO** hardcoded hex values (e.g., `bg-[#123456]`) in components. Use semantic variables (`bg-primary`, `text-foreground`) to support white-labeling and dark mode.

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

Any deviation from this model requires an explicit update to this document.
