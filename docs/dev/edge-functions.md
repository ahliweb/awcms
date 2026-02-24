> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3 (Backend & Database)

# Supabase Edge Functions

## Purpose

Document the current Edge Function runtime layout, secret conventions, and deploy workflow.

## Audience

- Backend and integration developers
- Operators deploying Supabase functions

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for backend constraints
- [AGENTS.md](../../AGENTS.md) - Supabase and security implementation rules
- Supabase CLI v2.70+

## Runtime Layout

- Canonical Supabase CLI path: `supabase/functions/`
- Admin mirror path used in some checks/workflows: `awcms/supabase/functions/`
- Keep function code aligned between both paths when both are used in your workflow.

Current function inventory:

| Function | Path | Purpose |
| --- | --- | --- |
| `verify-turnstile` | `supabase/functions/verify-turnstile/` | Validate Turnstile tokens with host-aware secret resolution |
| `manage-users` | `supabase/functions/manage-users/` | Account request workflow and admin user lifecycle actions |
| `mailketing` | `supabase/functions/mailketing/` | Mailketing send/subscribe/credits/list integrations |
| `mailketing-webhook` | `awcms/supabase/functions/mailketing-webhook/` | Mailketing webhook ingestion and email log updates |
| `serve-sitemap` | `awcms/supabase/functions/serve-sitemap/` | Tenant-aware XML sitemap response |

Shared helpers:

- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/turnstile.ts`
- `supabase/functions/_shared/types.d.ts`

## Secret and Env Naming

Use the current key names consistently:

- `SUPABASE_URL` (runtime-provided by Supabase)
- `SUPABASE_SECRET_KEY` (privileged server-side operations)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (caller-context auth checks when needed)
- `TURNSTILE_SECRET_KEY`, `TURNSTILE_SECRET_KEY_MAP`, `TURNSTILE_TEST_SECRET_KEY`
- `MAILKETING_API_TOKEN`

Do not use client-exposed runtime code to access `SUPABASE_SECRET_KEY`.

## Local Development

Run from repository root.

```bash
# Serve all functions
npx supabase functions serve --env-file awcms/.env.local

# Serve one function
npx supabase functions serve verify-turnstile --env-file awcms/.env.local

# Example test call
curl -i http://127.0.0.1:54321/functions/v1/verify-turnstile \
  -H "Content-Type: application/json" \
  -d '{"token":"test-token"}'
```

Operational note:

- `manage-users` accepts local `sb_secret_*` bearer tokens as a fallback only for local environments when `SUPABASE_SECRET_KEY` is not present.

## Deployment

```bash
# Deploy one function
npx supabase functions deploy verify-turnstile --project-ref <project_ref>

# Deploy all functions
npx supabase functions deploy --project-ref <project_ref>

# Set/update required secrets
npx supabase secrets set SUPABASE_SECRET_KEY=<secret> TURNSTILE_SECRET_KEY=<secret> --project-ref <project_ref>
```

## Troubleshooting

- Unauthorized responses: verify `Authorization` header and publishable/secret key separation.
- Turnstile failures: check `TURNSTILE_SECRET_KEY*` env values and host mapping JSON.
- Function not found: confirm deployment target project and folder path (`supabase/functions/*`).

## References

- `docs/dev/ci-cd.md`
- `docs/tenancy/supabase.md`
