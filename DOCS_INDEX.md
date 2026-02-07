# AWCMS Documentation Index

> **Documentation Authority**: This index follows the hierarchy defined in `SYSTEM_MODEL.md` → `AGENTS.md` → Implementation Guides.

## Purpose

Provide a single entry point for all AWCMS documentation across the monorepo and identify the canonical doc for each topic.

## Documentation Hierarchy (Context7 MCP Aligned)

All documentation follows this authority structure:

1. **[SYSTEM_MODEL.md](../SYSTEM_MODEL.md)** - **Single Source of Truth** for architecture, tech stack, and security mandates
2. **[AGENTS.md](../AGENTS.md)** - AI agent guidelines and coding standards  
3. **[DOCS_INDEX.md](./DOCS_INDEX.md)** - This file: navigation and canonical references
4. **Implementation Guides** - Specific how-to documentation

## Prerequisites

- **Start Here**: Read `SYSTEM_MODEL.md` for authoritative tech stack and architectural constraints
- **For AI Agents**: Follow `AGENTS.md` over all other instructions
- **For Developers**: Start with `docs/dev/setup.md` after reviewing SYSTEM_MODEL.md

---

## Canonical Docs Map

### Authoritative Sources

| Priority | Document | Purpose | Context7 Reference |
|----------|----------|---------|-------------------|
| **1** | [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) | Tech stack versions, architectural pillars, security mandates | Primary authority |
| **2** | [AGENTS.md](../AGENTS.md) | AI coding guidelines, Context7 library IDs, permission patterns | Agent operations |
| **3** | [DOCS_INDEX.md](./DOCS_INDEX.md) | Navigation and canonical references | This document |

### General

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| **System Model** | [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) | **Authoritative: Stack versions, architecture, security** |
| **AI Guidelines** | [AGENTS.md](../AGENTS.md) | **Authoritative: Coding standards, Context7 refs** |
| **Wiki / Guide** | [docs/README.md](./README.md) | Detailed repository guide & concepts |
| **Resource Map** | [RESOURCE_MAP.md](./RESOURCE_MAP.md) | Resource registry and permission mapping |

### Architecture

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| System Overview | [docs/architecture/overview.md](./architecture/overview.md) | Monorepo and runtime architecture |
| Tech Stack | [docs/architecture/tech-stack.md](./architecture/tech-stack.md) | Technologies used (aligns with SYSTEM_MODEL.md) |
| Core Standards | [docs/architecture/standards.md](./architecture/standards.md) | UI, coding, and quality standards |
| Folder Structure | [docs/architecture/folder-structure.md](./architecture/folder-structure.md) | Monorepo layout |
| Database Schema | [docs/architecture/database.md](./architecture/database.md) | Tables and relations |

### Tenancy

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Multi-Tenancy | [docs/tenancy/overview.md](./tenancy/overview.md) | Tenant resolution and isolation |
| Supabase Integration | [docs/tenancy/supabase.md](./tenancy/supabase.md) | Auth and service integration |
| Smandapbun Portal | [docs/tenancy/smandapbun.md](./tenancy/smandapbun.md) | Tenant-specific public portal notes |

### Security

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Security Overview | [docs/security/overview.md](./security/overview.md) | High-level security policy |
| Threat Model | [docs/security/threat-model.md](./security/threat-model.md) | OWASP ASVS alignment |
| ABAC System | [docs/security/abac.md](./security/abac.md) | **Primary Permission Logic** |
| RLS Policies | [docs/security/rls.md](./security/rls.md) | **Database Enforcement** |

### Modules & Guidelines

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Modules Guide | [docs/modules/MODULES_GUIDE.md](./modules/MODULES_GUIDE.md) | **Core Module Reference** |
| Role Hierarchy | [docs/modules/ROLE_HIERARCHY.md](./modules/ROLE_HIERARCHY.md) | **Role & Permission Concepts** |
| Theme System | [docs/modules/THEMING.md](./modules/THEMING.md) | Theme engine details |
| Extension System | [docs/modules/EXTENSIONS.md](./modules/EXTENSIONS.md) | Plugin and extension architecture |

### Developer Guides

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Setup Guide | [docs/dev/setup.md](./dev/setup.md) | **Start Here** |
| Admin Panel | [docs/dev/admin.md](./dev/admin.md) | React Admin development |
| Public Portal | [docs/dev/public.md](./dev/public.md) | Astro development |
| Mobile App | [docs/dev/mobile.md](./dev/mobile.md) | Flutter development |
| IoT Firmware | [docs/dev/esp32.md](./dev/esp32.md) | ESP32 platform |
| CI/CD | [docs/dev/ci-cd.md](./dev/ci-cd.md) | GitHub Actions |
| Testing | [docs/dev/testing.md](./dev/testing.md) | Vitest and smoke checks |

### Deployment

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| General Deployment | [docs/deploy/overview.md](./deploy/overview.md) | Deployment strategies |
| Cloudflare | [docs/deploy/cloudflare.md](./deploy/cloudflare.md) | Hosting on Cloudflare |

---

## Context7 MCP Integration

When implementing features, reference these Context7 library IDs:

- `supabase/supabase-js` - Database operations
- `vitejs/vite` - Build tooling
- `withastro/astro` - Public portal framework
- `/websites/react_dev` - React patterns
- `/websites/tailwindcss` - Styling
- `/remix-run/react-router` - Routing
- `/ueberdosis/tiptap-docs` - Rich text editor
- `/puckeditor/puck` - Visual builder
- `/grx7/framer-motion` - Animations

See [AGENTS.md](../AGENTS.md) for detailed Context7 usage patterns.

---

## Documentation Standards

All documentation must:
1. **Align with SYSTEM_MODEL.md** for tech stack and architecture
2. **Reference AGENTS.md** for coding standards and AI guidelines
3. **Use tables** for structured data
4. **Include code examples** with proper syntax highlighting
5. **Keep version numbers accurate** (check package.json against SYSTEM_MODEL.md)
6. **Use relative links** between docs files
7. **Update CHANGELOG.md** for significant changes

---

## Quick Reference

### For New Developers
1. Read [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) (5 min)
2. Read [docs/dev/setup.md](./dev/setup.md) (10 min)
3. Start coding with [AGENTS.md](../AGENTS.md) as your reference

### For AI Agents
1. **Primary**: [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) - Architecture & constraints
2. **Secondary**: [AGENTS.md](../AGENTS.md) - Implementation patterns
3. **Navigation**: This index for topic location

### For DevOps/Operations
1. [docs/deploy/overview.md](./deploy/overview.md) - Deployment strategies
2. [docs/security/overview.md](./security/overview.md) - Security requirements
3. [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) - Tech stack specifications
