> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Testing Guide

## Purpose

Describe how to validate AWCMS packages locally and in CI.

## Audience

- Contributors running tests before PRs
- Maintainers verifying releases

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for testing framework versions
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Node.js 22.12+ (admin/public/edge/mcp/shared)
- Flutter SDK (mobile)
- Wrangler CLI (edge worker typecheck — installed via `devDependencies` in `awcms-edge/`)

## Steps

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
npm run typecheck
```

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

## Troubleshooting

- Missing env vars: check `.env.local` and `.env` files.
- CI failures: compare commands with `.github/workflows/ci-push.yml` and `.github/workflows/ci-pr.yml`.

## References

- `docs/dev/ci-cd.md`
- `docs/architecture/database.md`
