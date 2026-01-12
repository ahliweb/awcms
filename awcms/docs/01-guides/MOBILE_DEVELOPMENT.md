# Mobile Development (Flutter)

## Purpose
Provide mobile integration guidance for AWCMS using Flutter and Supabase.

## Audience
- Mobile engineers
- Backend engineers supporting mobile features

## Prerequisites
- `awcms/docs/00-core/SUPABASE_INTEGRATION.md`
- Flutter 3.10+ and Dart 3+

## Core Concepts

- Mobile uses the same Supabase project as admin and public.
- Tenant isolation is enforced with `tenant_id` filters and RLS.
- Offline support uses Drift for local caching.

## How It Works

- Supabase client: `supabase_flutter`.
- Tenant context is stored locally and applied as a query filter.
- Sync services fetch tenant-scoped data and persist to Drift tables.

## Implementation Patterns

### Supabase Initialization

```dart
await Supabase.initialize(
  url: 'YOUR_SUPABASE_URL',
  anonKey: 'YOUR_SUPABASE_ANON_KEY',
);
```

### Tenant-Scoped Reads

```dart
final tenantId = await secureStorage.read(key: 'tenant_id');
final data = await Supabase.instance.client
  .from('articles')
  .select()
  .eq('tenant_id', tenantId)
  .eq('status', 'published');
```

## Permissions and Access

- Mobile must respect the same ABAC permissions as web.
- Use edge functions for privileged actions (e.g., user approvals).

## Security and Compliance Notes

- Never store service role keys in mobile apps.
- Filter `deleted_at` and `tenant_id` on every query.

## Operational Concerns

- Offline-first logic uses Drift tables for caching.
- Ensure sync services handle conflicts and network loss.

## References

- `../../awcms-mobile/primary/README.md`
- `../00-core/MULTI_TENANCY.md`
- `../03-features/ABAC_SYSTEM.md`
