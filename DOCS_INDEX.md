# AWCMS Documentation Index

> **Documentation Authority**: This index follows the hierarchy defined in `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> Implementation Guides.

## Purpose

Provide a single entry point for all AWCMS documentation across the monorepo and identify the canonical doc for each topic.

## Documentation Hierarchy (Context7 MCP Aligned)

All documentation follows this authority structure:

1. **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - **Single Source of Truth** for architecture, tech stack, and security mandates
2. **[AGENTS.md](AGENTS.md)** - AI agent guidelines and coding standards
3. **[README.md](README.md)** - Canonical monorepo overview and operational baseline
4. **[DOCS_INDEX.md](DOCS_INDEX.md)** - This file: navigation and canonical references
5. **Implementation Guides** - Specific how-to documentation

## Prerequisites

- **Start Here**: Read [SYSTEM_MODEL.md](SYSTEM_MODEL.md) for authoritative tech stack and architectural constraints
- **For AI Agents**: Follow [AGENTS.md](AGENTS.md) over all other instructions
- **Operational Summary**: Review [README.md](README.md) before diving into module docs
- **For Developers**: Start with [docs/dev/setup.md](docs/dev/setup.md) after reviewing SYSTEM_MODEL.md

---

## Canonical Docs Map

### Authoritative Sources

| Priority | Document | Purpose | Context7 Reference |
|----------|----------|---------|-------------------|
| **1** | [SYSTEM_MODEL.md](SYSTEM_MODEL.md) | Tech stack versions, architectural pillars, security mandates | Primary authority |
| **2** | [AGENTS.md](AGENTS.md) | AI coding guidelines, Context7 library IDs, permission patterns | Agent operations |
| **3** | [README.md](README.md) | Canonical monorepo overview and baseline commands | Runtime entrypoint |
| **4** | [DOCS_INDEX.md](DOCS_INDEX.md) | Navigation and canonical references | This document |

### General

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| **System Model** | [SYSTEM_MODEL.md](SYSTEM_MODEL.md) | **Authoritative: Stack versions, architecture, security** |
| **AI Guidelines** | [AGENTS.md](AGENTS.md) | **Authoritative: Coding standards, Context7 refs** |
| **Documentation Hub** | [docs/README.md](docs/README.md) | Practical docs entrypoint and routing |
| **Resource Map** | [docs/RESOURCE_MAP.md](docs/RESOURCE_MAP.md) | Resource registry and permission mapping |

### Architecture

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| System Overview | [docs/architecture/overview.md](docs/architecture/overview.md) | Monorepo and runtime architecture |
| Tech Stack | [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md) | Technologies used (aligns with SYSTEM_MODEL.md) |
| Core Standards | [docs/architecture/standards.md](docs/architecture/standards.md) | UI, coding, and quality standards |
| Folder Structure | [docs/architecture/folder-structure.md](docs/architecture/folder-structure.md) | Monorepo layout |
| Database Schema | [docs/architecture/database.md](docs/architecture/database.md) | Tables and relations |

### Product & Specs

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Product Requirements | [docs/product/PRD.md](docs/product/PRD.md) | Overview, requirements, feature scope, architecture, and constraints |
| User Stories | [docs/product/USER_STORY.md](docs/product/USER_STORY.md) | Product-area stories grouped by persona |
| Acceptance Criteria | [docs/product/ACCEPTANCE_CRITERIA.md](docs/product/ACCEPTANCE_CRITERIA.md) | Testable checks aligned to PRD sections |

### Tenancy

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Multi-Tenancy | [docs/tenancy/overview.md](docs/tenancy/overview.md) | Tenant resolution and isolation |
| Supabase Integration | [docs/tenancy/supabase.md](docs/tenancy/supabase.md) | Auth and service integration |
| Smandapbun Portal | [docs/tenancy/smandapbun.md](docs/tenancy/smandapbun.md) | Tenant-specific public portal notes |

### Security

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Security Overview | [docs/security/overview.md](docs/security/overview.md) | High-level security policy |
| Threat Model | [docs/security/threat-model.md](docs/security/threat-model.md) | OWASP ASVS alignment |
| ABAC System | [docs/security/abac.md](docs/security/abac.md) | **Primary Permission Logic** |
| RLS Policies | [docs/security/rls.md](docs/security/rls.md) | **Database Enforcement** |

### Modules & Guidelines

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Modules Guide | [docs/modules/MODULES_GUIDE.md](docs/modules/MODULES_GUIDE.md) | **Core Module Reference** |
| Role Hierarchy | [docs/modules/ROLE_HIERARCHY.md](docs/modules/ROLE_HIERARCHY.md) | **Role & Permission Concepts** |
| User Management | [docs/modules/USER_MANAGEMENT.md](docs/modules/USER_MANAGEMENT.md) | User lifecycle, profiles, and roles |
| Theme System | [docs/modules/THEMING.md](docs/modules/THEMING.md) | Theme engine details |
| Extension System | [docs/modules/EXTENSIONS.md](docs/modules/EXTENSIONS.md) | Plugin and extension architecture |

### Developer Guides

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Setup Guide | [docs/dev/setup.md](docs/dev/setup.md) | **Start Here** |
| Documentation Audit Plan | [docs/dev/documentation-audit-plan.md](docs/dev/documentation-audit-plan.md) | Active full-repository audit, review, and conflict-resolution plan |
| Documentation Audit Tracker | [docs/dev/documentation-audit-tracker.md](docs/dev/documentation-audit-tracker.md) | 2026-03-12 baseline, drift register, and execution status |
| Context7 Benchmark Playbook | [docs/dev/context7-benchmark-playbook.md](docs/dev/context7-benchmark-playbook.md) | Canonical benchmark answer structure and topic playbooks |
| Admin Panel | [docs/dev/admin.md](docs/dev/admin.md) | React Admin development |
| Public Portal | [docs/dev/public.md](docs/dev/public.md) | Astro development |
| Mobile App | [docs/dev/mobile.md](docs/dev/mobile.md) | Flutter development |
| IoT Firmware | [docs/dev/esp32.md](docs/dev/esp32.md) | ESP32 platform |
| CI/CD | [docs/dev/ci-cd.md](docs/dev/ci-cd.md) | GitHub Actions |
| Testing | [docs/dev/testing.md](docs/dev/testing.md) | Vitest and smoke checks |
| AI Workflows | [docs/dev/ai-workflows.md](docs/dev/ai-workflows.md) | Prompt templates, plan mode triggers, iteration loops |
| AI Gateway | [docs/architecture/openclaw-gateway.md](docs/architecture/openclaw-gateway.md) | OpenClaw per-tenant setup, routing, and security runbook |
| Autonomous Brain | [docs/architecture/ollama-integration.md](docs/architecture/ollama-integration.md) | Local Ollama runtime and OpenClaw hand-off guidance |
| Programmatic Content Types | [docs/architecture/schema-definition.md](docs/architecture/schema-definition.md) | Defining and migrating custom schemas |
| Edge Logic | [docs/dev/edge-functions.md](docs/dev/edge-functions.md) | Cloudflare Worker gateway over Supabase and Cloudflare R2 |
| Versioning Strategy | [docs/dev/versioning.md](docs/dev/versioning.md) | Monorepo versioning & release process |
| WordPress Migration | [docs/guides/wp-to-awcms-migration.md](docs/guides/wp-to-awcms-migration.md) | Migrating from WordPress Elementor to AWCMS |
| WP Migration Script | [docs/guides/wp-data-migration-script.md](docs/guides/wp-data-migration-script.md) | Node.js script to migrate WP posts to Supabase |

### Deployment

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| General Deployment | [docs/deploy/overview.md](docs/deploy/overview.md) | Deployment strategies |
| Cloudflare | [docs/deploy/cloudflare.md](docs/deploy/cloudflare.md) | Hosting on Cloudflare |

### Compliance

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| Compliance Overview | [docs/compliance/overview.md](docs/compliance/overview.md) | Framework mapping summary |
| UU PDP (Law 27/2022) | [docs/compliance/pdp-uu27-2022.md](docs/compliance/pdp-uu27-2022.md) | Indonesian personal data protection |
| PP 71/2019 (PSTE) | [docs/compliance/pp71-2019-pste.md](docs/compliance/pp71-2019-pste.md) | Electronic system obligations |
| ISO Mapping | [docs/compliance/iso-mapping.md](docs/compliance/iso-mapping.md) | ISO 27001–15408 control mapping |
| Indonesia Guide | [docs/compliance/indonesia.md](docs/compliance/indonesia.md) | Combined Indonesia compliance overview |

### Agent Guidance

| Topic | Path | Notes |
| --- | --- | --- |
| Agent Rules | `.agents/rules/` | Local agent guardrail playbooks when the optional directory is present |
| Agent Skills | `.agents/skills/` | Local technology-specific skills when the optional directory is present |
| Agent Workflows | `.agents/workflows/` | Local step-by-step procedures when the optional directory is present |

---

## Context7 MCP Integration

When implementing features, reference these Context7 library IDs:

- `supabase/supabase-js` - Database operations
- `vitejs/vite` - Build tooling
- `withastro/docs` - Public portal framework
- `remix-run/react-router` - Routing
- `websites/react_dev` - React patterns
- `websites/tailwindcss` - Styling
- `ueberdosis/tiptap-docs` - Rich text editor
- `puckeditor/puck` - Visual builder
- `grx7/framer-motion` - Animations
- `openclaw/openclaw` - AI Gateway, Multi-Agent Routing
- `ollama/ollama` - Self-hosted LLM runtime
- `ollama/ollama-js` - Ollama Node.js SDK

See [AGENTS.md](AGENTS.md) for detailed Context7 usage patterns.

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

1. Read [SYSTEM_MODEL.md](SYSTEM_MODEL.md) (5 min)
2. Read [docs/dev/setup.md](docs/dev/setup.md) (10 min)
3. Start coding with [AGENTS.md](AGENTS.md) as your reference

### For AI Agents

1. **Primary**: [SYSTEM_MODEL.md](SYSTEM_MODEL.md) - Architecture & constraints
2. **Secondary**: [AGENTS.md](AGENTS.md) - Implementation patterns
3. **Navigation**: This index for topic location

### For DevOps/Operations

1. [docs/deploy/overview.md](docs/deploy/overview.md) - Deployment strategies
2. [docs/security/overview.md](docs/security/overview.md) - Security requirements
3. [SYSTEM_MODEL.md](SYSTEM_MODEL.md) - Tech stack specifications
