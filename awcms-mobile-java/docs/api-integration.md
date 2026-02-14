# API Integration Guide

## Base Endpoints

```
SUPABASE_URL=https://<project>.supabase.co
REST_BASE=${SUPABASE_URL}/rest/v1
AUTH_BASE=${SUPABASE_URL}/auth/v1
FUNCTIONS_BASE=${SUPABASE_URL}/functions/v1
STORAGE_BASE=${SUPABASE_URL}/storage/v1
```

## Required Headers

- `apikey: <SUPABASE_PUBLISHABLE_KEY>`
- `Authorization: Bearer <access-token>` (after login)
- `x-tenant-id: <tenant-id>` (tenant scoping)
- `Accept: application/json`

## Authentication

- Sign-in via `POST /auth/v1/token?grant_type=password`.
- Refresh tokens via `POST /auth/v1/token?grant_type=refresh_token`.
- Store tokens in encrypted storage and refresh before expiry.

## Tenant Scoping

- Always add `tenant_id=eq.<tenantId>` to PostgREST queries.
- Use `x-tenant-id` for Edge Functions and analytics.
- Do not query across tenants; rely on RLS for enforcement.

## Example: Fetch Blogs

```
GET /rest/v1/blogs?tenant_id=eq.<tenantId>&select=*
```

## Edge Functions

```
POST /functions/v1/verify-turnstile
```

## Error Handling

- **401/403**: refresh token or force logout.
- **404**: show empty states.
- **429**: backoff and retry.
- **5xx**: show retry UI and log to crash reporting.

## Response Parsing

- Supabase returns JSON with `message` or `error` fields on failure.
- Normalize errors into a shared `ApiError` model for the UI.
