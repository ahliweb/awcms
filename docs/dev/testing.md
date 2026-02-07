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
- Node.js 20+ (admin/public)
- Flutter SDK (mobile)

## Steps

### Admin Panel

```bash
cd awcms
npm run lint
npm run test -- --run
npm run build
```

### Public Portal

```bash
cd awcms-public/primary
npm run check
npm run build
```

### Mobile App

```bash
cd awcms-mobile/primary
flutter test
```

### Docs Links

```bash
cd awcms
npm run docs:check
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
