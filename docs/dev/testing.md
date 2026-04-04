> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Testing Guide

## Purpose

Describe how to validate AWCMS packages locally and in CI.

This guide also defines the minimum determinism requirements expected by the AWCMS audit workflow.

## Audience

- Contributors running tests before PRs
- Maintainers verifying releases

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for testing framework versions
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Node.js 24.14.1+ (admin/public/edge/mcp/shared)
- Flutter SDK (mobile)
- Wrangler CLI (edge worker typecheck — installed via `devDependencies` in `awcms-edge/`)

## Steps

### Deterministic Test Rules

- Tests must not depend on leftover database or storage state.
- API and Worker tests should seed, reset, or clean state before execution.
- Validation failures and authorization failures should be tested intentionally, not treated as optional coverage.
- If a test touches Supabase-backed state, setup and teardown should be explicit in the test or harness.
- If a change affects a shared contract, verify all affected surfaces, not only the package you edited.

### Admin Panel (`awcms/`)

Uses **Vitest 4.1.0** for unit and integration tests.

```bash
cd awcms
npm run lint
npm run test -- --run
npm run build
```

### Public Portal — Primary (`awcms-public/primary/`)

```bash
cd awcms-public/primary
npm run check
npm run build
```

### Public Portal — Smandapbun (`awcms-public/smandapbun/`)

```bash
cd awcms-public/smandapbun
npm run check
npm run lint
npm run build
```

### Edge Worker (`awcms-edge/`)

Runs TypeScript type checking via Wrangler (`^4.77.0`).

```bash
cd awcms-edge
npm run openapi:build
npm run openapi:validate
npm run openapi:diff
npm run test
npm run typecheck
```

For Worker route changes, include negative-path verification for:
- malformed input
- missing or invalid auth
- permission failures
- docs-surface and OpenAPI drift where the route is documented

### MCP Server (`awcms-mcp/`)

```bash
cd awcms-mcp
npm run lint
npm run build
```

### Shared Package (`packages/awcms-shared/`)

```bash
cd packages/awcms-shared
npm install
npm run typecheck
```

### Mobile App (`awcms-mobile/primary/`)

```bash
cd awcms-mobile/primary
flutter pub get
flutter analyze
flutter test
```

### Docs Links

```bash
cd awcms
npm run docs:check
```

### Database Lint

```bash
cd awcms/supabase
npx supabase db lint
```

## Verification

- Admin loads and resolves tenant context.
- Public portal renders pages via `PuckRenderer`.
- ABAC restrictions block unauthorized actions.
- Soft delete updates `deleted_at` instead of hard deletes.
- Worker validation rejects malformed requests before sensitive writes.
- Tests remain reproducible when re-run from a clean checkout.

## Troubleshooting

- Missing env vars: check `.env.local` and `.env` files.
- CI failures: compare commands with `.github/workflows/ci-push.yml` and `.github/workflows/ci-pr.yml`.

## References

- `docs/dev/ci-cd.md`
- `docs/dev/ai-planning-workflow.md`
- `docs/audit/awcms-vibe-engineering-audit-checklist.md`
- `docs/architecture/database.md`
