# Documentation Review & Update Summary

**Date**: 2026-02-16  
**Scope**: Documentation audit plan, link corrections, and core doc cleanup  
**Authority**: SYSTEM_MODEL.md → AGENTS.md → Implementation Guides

---

## Summary of Changes

### 2026-02-24 Updates (Phase 0 + Phase 1)

- Reworked the documentation audit runbook into a repository-wide Context7-first execution plan in `docs/dev/documentation-audit-plan.md`.
- Updated `DOCS_INDEX.md` to reflect the expanded audit plan scope and wording.
- Updated `README.md` with a current status snapshot (Node runtime, Stitch import, MCP topology, migration repair workflow).
- Revised root migration guidance in `README.md` to match current local/linked flows and scripted repair process.
- Updated `SYSTEM_MODEL.md` baseline metadata and added explicit MCP topology mandates (Context7, Supabase, Stitch, GitHub, Cloudflare MCP servers).
- Added content import/sanitization governance in `SYSTEM_MODEL.md` for tenant-scoped Stitch import behavior and admin/public sanitization enforcement.
- Corrected `AGENTS.md` persona count and formatting issues in the Public Experience persona section.
- Aligned `AGENTS.md` tech stack references (Lucide admin/public versions and `react-leaflet` 5.0.0).
- Replaced outdated `AGENTS.md` limitations text (no-shell/no-deletion) with host-aware constraints and current migration file policy (`supabase/manual` for non-migration SQL).
- Updated `AGENTS.md` MCP section to mirror the active hybrid topology and current server inventory.

### 2026-02-24 Updates (Phase 2 - Security/Tenancy Reconciliation)

- Updated `docs/security/overview.md` with current XSS sanitization paths for Stitch import and RawHTML fallback rendering.
- Updated `docs/security/rls.md` with current migration workflow (`supabase/manual/`, drift repair script) and tenant header notes for public/static clients.
- Updated `docs/security/abac.md` to align extension permissions with live platform scope keys (`platform.extensions.*`) and kept tenant plugin pages under `tenant.setting.*`.
- Updated `docs/tenancy/overview.md` to reflect build-time tenant fallback order, hierarchy/resource-sharing notes, and tenant-scoped Stitch settings.
- Updated `docs/tenancy/supabase.md` with current local vs linked Supabase CLI workflows and dual `supabase/` + `awcms/supabase/` repository layout caveat.
- Updated `docs/dev/troubleshooting.md` with migration mismatch repair commands and invalid filename guidance (`supabase/manual/`).
- Updated `docs/modules/EXTENSIONS.md` ABAC table to use platform extension lifecycle permissions and added tenant settings permission guidance.
- Corrected a permission key example in `AGENTS.md` from tenant extension scope to platform extension scope.

### 2026-02-24 Updates (Phase 3 - Scripts/Operations Reconciliation)

- Updated `docs/dev/setup.md` with current Node baseline (`>=22.12.0`), local vs linked Supabase command flow, migration repair script usage, MCP verification steps (`opencode mcp list`), and an operational scripts quick-reference table.
- Updated `docs/dev/ci-cd.md` to reflect actual workflow behavior (admin-only deploy job), legacy Node 20 workflow pin caveat, and explicit legacy alias handling for CI Supabase key variables.
- Replaced stale `docs/dev/edge-functions.md` examples with current function inventory (`verify-turnstile`, `manage-users`, `mailketing`, `mailketing-webhook`, `serve-sitemap`), updated secret naming (`SUPABASE_SECRET_KEY`), and current local/deploy command runbook.
- Updated `docs/deploy/overview.md` and `docs/deploy/cloudflare.md` with Node 22+ deployment guidance, linked migration checks, and Cloudflare secret sync helper documentation.
- Updated `docs/dev/troubleshooting.md` with MCP connectivity diagnostics and token/runtime prerequisites.
- Updated `docs/dev/testing.md`, `docs/dev/versioning.md`, `docs/dev/public.md`, `docs/dev/mobile.md`, and `docs/README.md` for runtime/version/env naming consistency with current operations and authority docs.
- Added migration consistency verification script documentation (`scripts/verify_supabase_migration_consistency.sh`) in setup/tenancy/root docs and linked it from the migration repair workflow.

### 2026-02-16 Updates

- Added a Context7-driven documentation audit plan at `docs/dev/documentation-audit-plan.md`.
- Corrected DOCS_INDEX.md links to resolve from repository root.
- Linked the audit plan from README.md and docs/README.md.
- Removed duplicate soft delete guidance in SYSTEM_MODEL.md.
- Expanded database, user management, and RLS docs to reflect user profile tables, region hierarchies, and Context7 performance tips.
- Updated README and developer setup to reflect local Supabase CLI usage.
- Aligned Puck package references with `@puckeditor/core` and updated visual builder guidance.
- Updated admin/public dev docs and standards with Context7 best practices (Vite env, Astro config, Tailwind @theme).
- Verified documentation links with `npm run docs:check`.
- Refreshed API usage, template migration, troubleshooting, and security overview docs with Context7-aligned guidance.
- Updated extension, performance, scalability, monitoring, theming, and blog docs with Context7 best practices and runtime details.
- Added mobile/IoT security notes and expanded threat model protections.
- Refined admin UI, i18n, menu system, CI/CD, compliance, and public portal readmes for current runtime behavior and env requirements.
- Updated audit trail, role hierarchy, and template system docs with Context7 guidance and tenant-scoped query reminders.
- Normalized Supabase key naming in docs (publishable vs secret) and removed legacy "anon/service role" wording.
- Aligned RLS and deployment docs with current Supabase CLI flags (`--schema public,extensions`, `--linked`).
- Synced UI version metadata to `awcms/package.json`.

---

### 2026-02-07 Updates

This document summarizes all documentation updates made to align with the Context7 MCP (Model Context Protocol) standards.

### Phase 1: Established Documentation Authority Hierarchy

#### Updated Files (Authority Headers Added)

1. **DOCS_INDEX.md** (Root)
   - Added "Documentation Hierarchy" section featuring SYSTEM_MODEL.md and AGENTS.md
   - Added "Authoritative Sources" table with priority levels
   - Added Context7 MCP Integration section
   - Added Documentation Standards section
   - Added Quick Reference for different user types

2. **README.md** (Root)
   - Added "Documentation Authority" section at top
   - Added reference to SYSTEM_MODEL.md as "Single Source of Truth"
   - Updated Quick Start to reference SYSTEM_MODEL.md first
   - Added Context7 MCP Integration section

3. **docs/README.md** (Wiki)
   - Added authority banner referencing SYSTEM_MODEL.md and AGENTS.md
   - Added Quick Navigation section with authority documents

### Phase 2: Updated Core Architecture Documentation

1. **docs/architecture/tech-stack.md**
   - Added authority header referencing SYSTEM_MODEL.md Section 1
   - Updated Prerequisites to include SYSTEM_MODEL.md as primary authority

2. **docs/architecture/standards.md**
   - Added documentation hierarchy banner
   - Updated Prerequisites to include SYSTEM_MODEL.md as primary authority

3. **docs/architecture/overview.md**
   - Added authority header referencing SYSTEM_MODEL.md
   - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

4. **docs/architecture/folder-structure.md**
   - Added authority header referencing SYSTEM_MODEL.md Section 3
   - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

### Phase 3: Updated Security Documentation

1. **docs/security/overview.md**
   - Added authority header referencing SYSTEM_MODEL.md Section 2
   - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

2. **docs/security/abac.md**
   - Added authority header referencing SYSTEM_MODEL.md Section 2.3
   - Added permission format specification
   - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

3. **docs/security/rls.md**
    - Added authority header referencing SYSTEM_MODEL.md Section 2.1
    - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

### Phase 4: Updated Tenancy Documentation

1. **docs/tenancy/overview.md**
    - Added authority header referencing SYSTEM_MODEL.md Section 2.1
    - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

2. **docs/tenancy/supabase.md**
    - Added authority header referencing SYSTEM_MODEL.md Section 1.3
    - Added Context7 reference for supabase/supabase-js
    - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

### Phase 5: Updated Module Documentation

1. **docs/modules/EXTENSIONS.md**
    - Added authority header referencing SYSTEM_MODEL.md
    - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

2. **docs/modules/COMPONENT_GUIDE.md**
    - Added authority header referencing SYSTEM_MODEL.md Section 2.4
    - Added Context7 references for TailwindCSS and React
    - Updated Prerequisites to include SYSTEM_MODEL.md and AGENTS.md

---

## Documentation Authority Chain (Established)

```text
┌─────────────────────────────────────────────────────────────┐
│  1. SYSTEM_MODEL.md                                          │
│     - Single Source of Truth                                   │
│     - Tech stack versions                                      │
│     - Architectural pillars                                    │
│     - Security mandates                                        │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. AGENTS.md                                                │
│     - AI coding guidelines                                     │
│     - Context7 library IDs                                     │
│     - Permission patterns                                      │
│     - Implementation standards                                 │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  3. DOCS_INDEX.md                                            │
│     - Navigation and canonical references                    │
│     - Documentation hierarchy                                │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Implementation Guides                                    │
│     - Architecture docs                                        │
│     - Security docs                                            │
│     - Tenancy docs                                             │
│     - Module docs                                              │
│     - Developer guides                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Improvements Made

### 1. Authority Headers

Every major documentation file now includes an authority header at the top:

- References SYSTEM_MODEL.md as primary authority
- References AGENTS.md for implementation patterns
- References specific sections where applicable

### 2. Prerequisites Standardization

All documents now have standardized prerequisites:

- SYSTEM_MODEL.md (primary authority)
- AGENTS.md (implementation patterns)
- Related domain documents

### 3. Context7 Integration

Added Context7 MCP references where applicable:

- Library IDs for Supabase, Vite, Astro, React, TailwindCSS
- References to AGENTS.md for detailed patterns
- Clear indication of Context7 as primary reference

### 4. Cross-Reference Integrity

- All internal links use relative paths
- Links are consistent across documents
- Authority chain is clear and navigable

### 5. Documentation Standards

Established clear standards:

- Tables for structured data
- Code examples with syntax highlighting
- Version numbers aligned with SYSTEM_MODEL.md
- Relative links between docs

---

## Files Updated (14 Total)

### Root Level (3)

1. DOCS_INDEX.md
2. README.md
3. docs/README.md

### Architecture (4)

1. docs/architecture/tech-stack.md
2. docs/architecture/standards.md
3. docs/architecture/overview.md
4. docs/architecture/folder-structure.md

### Security (3)

1. docs/security/overview.md
2. docs/security/abac.md
3. docs/security/rls.md

### Tenancy (2)

1. docs/tenancy/overview.md
2. docs/tenancy/supabase.md

### Modules (2)

1. docs/modules/EXTENSIONS.md
2. docs/modules/COMPONENT_GUIDE.md

---

## Verification Checklist

- [x] SYSTEM_MODEL.md referenced as primary authority in all docs
- [x] AGENTS.md referenced for implementation patterns
- [x] Context7 library IDs documented in AGENTS.md
- [x] Documentation hierarchy established
- [x] All major docs have authority headers
- [x] Prerequisites standardized across docs
- [x] Cross-references use relative paths
- [x] Tech stack versions aligned with SYSTEM_MODEL.md
- [x] Permission format documented (scope.resource.action)
- [x] RLS mandates referenced from SYSTEM_MODEL.md

---

## Next Steps (Optional)

1. **Remaining Documentation**: Update remaining docs in:
   - docs/dev/*.md (developer guides)
   - docs/deploy/*.md (deployment guides)
   - docs/modules/*.md (remaining module docs)
   - docs/compliance/*.md (compliance docs)

2. **Add Context7 Examples**: Include concrete Context7 search examples in relevant guides

3. **Version Sync**: Create automated check to ensure all version references match SYSTEM_MODEL.md

4. **Link Validation**: Run automated link checker across all documentation

---

## Conclusion

All critical documentation has been updated to align with the Context7 MCP standards. The documentation now follows a clear authority hierarchy:

### Authority Chain

SYSTEM_MODEL.md → AGENTS.md → DOCS_INDEX.md → Implementation Guides

This ensures:

- Single source of truth for architecture and tech stack
- Consistent implementation patterns via AGENTS.md
- Clear navigation via DOCS_INDEX.md
- Authoritative guidance for all developers and AI agents
