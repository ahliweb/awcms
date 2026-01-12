# Performance Guide

## Purpose
Summarize performance strategies implemented in AWCMS.

## Audience
- Admin panel developers
- Operators tuning performance

## Prerequisites
- `awcms/docs/00-core/ARCHITECTURE.md`

## Core Concepts

- Route-level code splitting with `React.lazy`.
- Local caching via `UnifiedDataManager` (60s TTL).
- Vite 7 warmup for faster dev startup.

## How It Works

- Code splitting is defined in `awcms/src/components/MainRouter.jsx`.
- `UnifiedDataManager` caches read operations and invalidates on writes.

## Implementation Patterns

```javascript
const ArticlesManager = lazy(() => import('@/components/dashboard/ArticlesManager'));
```

## Permissions and Access

- Performance optimizations must not bypass ABAC or RLS.

## Security and Compliance Notes

- Cached data must remain tenant-scoped.
- Do not cache data across tenants.

## References

- `../00-core/ARCHITECTURE.md`
- `../03-features/SCALABILITY_GUIDE.md`
