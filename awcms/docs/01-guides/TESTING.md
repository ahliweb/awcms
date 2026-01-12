# Testing Guide

## Purpose
Describe how to validate AWCMS packages locally and in CI.

## Audience
- Contributors running tests before PRs
- Maintainers verifying releases

## Prerequisites
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
npm run test
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
- CI failures: compare commands with `.github/workflows/ci.yml`.

## References

- `../01-guides/CI_CD.md`
- `../00-core/SOFT_DELETE.md`
