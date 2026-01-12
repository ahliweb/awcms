# Documentation Structure Standard

## Purpose
Define the canonical structure for AWCMS documentation and prevent duplication or drift.

## Audience
- Contributors writing or updating documentation
- Maintainers reviewing documentation changes

## Prerequisites
- `AGENTS.md` must be followed over any other instruction
- `awcms/docs/00-core/CORE_STANDARDS.md` defines core architecture constraints

## Canonical Structure Templates

Use the template that matches the document type.

### 1. Core Docs (00-core)

Required sections:
- Purpose
- Audience
- Prerequisites
- Core Concepts
- How It Works
- Implementation Patterns
- Security and Compliance Notes
- Operational Concerns
- Troubleshooting
- References

### 2. Guides (01-guides)

Required sections:
- Purpose
- Audience
- Prerequisites
- Steps
- Verification
- Troubleshooting
- References

### 3. Reference Docs (02-reference)

Required sections:
- Purpose
- Audience
- Prerequisites
- Reference
- Security and Compliance Notes
- References

### 4. Feature Docs (03-features)

Required sections:
- Purpose
- Audience
- Prerequisites
- Core Concepts
- How It Works
- Implementation Patterns
- Permissions and Access
- Security and Compliance Notes
- Operational Concerns
- References

### 5. Package Readmes

Required sections:
- Purpose
- Audience
- Prerequisites
- Quick Start
- Environment Variables
- Project Structure (brief)
- References

## Consistency Rules

- Prefer one canonical document per topic. Other docs must link to it.
- Do not duplicate AGENTS.md or core standards; reference them.
- Use absolute repo paths for code references where possible (example: `awcms/src/contexts/TenantContext.jsx`).
- Use the permission format `scope.resource.action` and document the exact keys used by the code.
- Always state tenant isolation, ABAC, RLS, and soft delete expectations in Security and Compliance Notes.
- Avoid hardcoded colors in UI examples; use Tailwind tokens or CSS variables.

## Link Hygiene

- All internal links must resolve to valid files in the repo.
- External links must point to stable upstream sources (official docs).
- Prefer relative links for internal docs.
