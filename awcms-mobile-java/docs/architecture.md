# Architecture Overview

## Position in the AWCMS Ecosystem
- **Admin Panel**: `awcms/` (React/Vite) manages content, roles, and settings.
- **Public Portal**: `awcms-public/` (Astro) serves tenant websites.
- **Mobile Java**: `awcms-mobile-java/` delivers a native Android client.
- **Backend**: Supabase (Auth, PostgREST, Storage, Edge Functions) with RLS.

## Module Boundaries
The Android app follows a layered structure to keep UI, domain logic, and data
integration isolated:

- **UI layer**: Activities, Fragments, ViewModels, and adapters.
- **Domain layer**: Use cases and entities (business rules).
- **Data layer**: Repositories and data sources (remote and local).
- **Core layer**: Network clients, auth session manager, and secure storage.

## Data Flow
1. User authenticates via Supabase Auth (`/auth/v1`).
2. Access and refresh tokens are stored in encrypted storage.
3. API calls include `apikey`, `Authorization`, and `x-tenant-id` headers.
4. Supabase RLS filters rows by `tenant_id`.
5. Edge Functions are used for privileged operations (never use service keys).
6. Local cache (Room) stores read-heavy data for offline access.

## Tenant Scoping
- The tenant is resolved from the user profile or a tenant selector screen.
- Every request includes `x-tenant-id` and a `tenant_id` filter where relevant.
- Content creation is allowed for `mobile` or `web` channels; publishing remains
  web-only per AWCMS governance rules.

## Cross-Module Contracts
- **Auth**: Supabase GoTrue REST endpoints.
- **Data**: PostgREST queries against tenant-scoped tables.
- **Media**: Supabase Storage buckets (`/storage/v1`).
- **Audit**: Edge Functions for sensitive actions.
