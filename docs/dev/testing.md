> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Testing Guide

## Purpose

Describe the current validation workflow for AWCMS packages locally and in CI, with emphasis on deterministic checks, cross-surface verification, and the commands that reflect the current repo state.

## Current Testing Model

AWCMS validation is workspace-specific and contract-aware.

Current expectations:

- run the smallest relevant checks for the changed surface
- include negative-path verification when trust boundaries changed
- verify shared contracts across affected surfaces instead of testing only the file you edited
- keep docs/spec artifacts aligned when documented runtime behavior changes

## Current Determinism Rules

- tests must not depend on leftover database or storage state
- Worker and integration tests should seed/reset/mock state explicitly
- validation failures and authorization failures should be tested intentionally where relevant
- rerunning checks from a clean checkout should produce the same result
- generated artifacts should be rebuilt when their source metadata changes

## Current Workspace Validation Commands

### Admin (`awcms/`)

```bash
cd awcms
npm run build
```

Use additional workspace-local tests/lint commands when the touched surface already has them, but `npm run build` remains the most reliable baseline gate for ordinary admin changes.

### Public Portal — Primary (`awcms-public/primary/`)

```bash
cd awcms-public/primary
npm run check:astro
```

Use the workspace build/check path if the change affects deployment/build behavior beyond ordinary Astro validation.

### Public Portal — Smandapbun (`awcms-public/smandapbun/`)

Run the relevant workspace validation command(s) for that portal.

When in doubt, inspect the workspace manifest rather than copying `primary` assumptions blindly.

### Edge Worker (`awcms-edge/`)

```bash
cd awcms-edge
npm test
npm run typecheck
```

For documented route/catalog changes also run:

```bash
cd awcms-edge
npm run openapi:build
npm run openapi:validate
npm run openapi:diff
```

### MCP Server (`awcms-mcp/`)

Run the current workspace build/lint commands from its manifest when touched.

### Shared Package (`packages/awcms-shared/`)

Run the relevant package validation command(s) when touched.

### Mobile App (`awcms-mobile/primary/`)

```bash
cd awcms-mobile/primary
flutter pub get
flutter analyze
flutter test
```

### Docs

```bash
cd awcms
npm run docs:check
```

### Migration Parity

```bash
scripts/verify_supabase_migration_consistency.sh
```

## Current Negative-Path Expectations

When a change touches auth, permissions, validation, or public trust boundaries, current expectations include verifying relevant negative paths such as:

- malformed input
- missing auth
- invalid auth
- permission failures
- tenant/domain mismatch failures
- invalid public media key failures
- route catalog/OpenAPI drift where documented route metadata changed

## Current Cross-Surface Rules

If a shared contract changed, verify all affected surfaces.

Examples:

- edge route contract -> edge tests + OpenAPI generation/validation + docs check
- public route behavior -> public validation + edge validation if Worker-backed
- ABAC/RLS/migration changes -> migration parity + edge/docs validation where relevant
- admin/public shared content behavior -> validate both consuming workspaces when the change crosses boundaries

## Current Verification Goals

- admin resolves tenant context and builds cleanly
- public portal renders only the intended published/non-deleted content path
- ABAC/RLS boundaries remain intact
- Worker validation rejects malformed/unauthorized requests before sensitive operations
- public route guardrails remain explicit when touched
- generated OpenAPI artifacts stay in sync when their source metadata changed

## Troubleshooting

- missing env vars: verify the relevant workspace env configuration
- docs failure: fix local links and stale references before continuing
- edge failure: check whether the route contract, route catalog, and docs diverged
- parity failure: verify root/mirrored migration trees are still aligned
- CI mismatch: compare local commands with the actual workflow file rather than assuming older CI behavior

## Related Docs

- [docs/dev/ci-cd.md](./ci-cd.md)
- [docs/dev/ai-planning-workflow.md](./ai-planning-workflow.md)
- [docs/dev/openapi-quality-checklist.md](./openapi-quality-checklist.md)
- [docs/audit/awcms-vibe-engineering-audit-checklist.md](../audit/awcms-vibe-engineering-audit-checklist.md)
