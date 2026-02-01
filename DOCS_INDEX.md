# AWCMS Documentation Index

## Purpose

Provide a single entry point for all AWCMS documentation across the monorepo and identify the canonical doc for each topic.

## Prerequisites

- Read and follow `AGENTS.md` (single source of truth for AI rules).
- For architecture overview, read `docs/architecture/overview.md`.

## Canonical Docs Map

### General

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| **Wiki / Guide** | `docs/README.md` | **Detailed repository guide & concepts** |

### Architecture

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| System Overview | `docs/architecture/overview.md` | Monorepo and runtime architecture |
| Tech Stack | `docs/architecture/tech-stack.md` | Technologies used |
| Core Standards | `docs/architecture/standards.md` | UI, coding, and quality standards |
| Folder Structure | `docs/architecture/folder-structure.md` | Monorepo layout |
| Database Schema | `docs/architecture/database.md` | Tables and relations |

### Tenancy

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Multi-Tenancy | `docs/tenancy/overview.md` | Tenant resolution and isolation |
| Supabase Integration | `docs/tenancy/supabase.md` | Auth and service integration |

### Security (Updated)

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Security Overview | `docs/security/overview.md` | High-level security policy |
| Threat Model | `docs/security/threat-model.md` | OWASP ASVS alignment |
| ABAC System | `docs/security/abac.md` | **Primary Permission Logic** |
| RLS Policies | `docs/security/rls.md` | **Database Enforcement** |

### Guidelines

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Modules Guide | `docs/modules/MODULES_GUIDE.md` | **Core Module Reference** |
| Role Hierarchy | `docs/modules/ROLE_HIERARCHY.md` | **Role & Permission Concepts** |
| Theme System | `docs/modules/THEMING.md` | Theme engine details |

### Developer Guides

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Setup Guide | `docs/dev/setup.md` | **Start Here** |
| Admin Panel | `docs/dev/admin.md` | React Admin development |
| Public Portal | `docs/dev/public.md` | Astro development |
| Mobile App | `docs/dev/mobile.md` | Flutter development |
| IoT Firmware | `docs/dev/esp32.md` | ESP32 platform |
| CI/CD | `docs/dev/ci-cd.md` | GitHub Actions |
| Testing | `docs/dev/testing.md` | Vitest and smoke checks |

### Deployment

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| General Deployment | `docs/deploy/overview.md` | Deployment strategies |
| Cloudflare | `docs/deploy/cloudflare.md` | Hosting on Cloudflare |
