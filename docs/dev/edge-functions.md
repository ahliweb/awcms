> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3 (Backend & Database)

# Edge Logic and Supabase Edge Functions

## Purpose

Document the current edge runtime layout, secret conventions, and deploy workflow across Cloudflare Workers and existing Supabase Edge Functions.

## Audience

- Backend and integration developers
- Operators deploying Cloudflare Workers and Supabase functions

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for backend constraints
- [AGENTS.md](../../AGENTS.md) - Supabase and security implementation rules
- Supabase CLI v2.70+

## Current Edge Runtime Model

- Cloudflare Workers in `awcms-edge/` are the primary edge HTTP layer.
- Supabase Edge Functions in `supabase/functions/` remain supported for legacy or transitional flows.
- `SUPABASE_SECRET_KEY` may be used only in approved server-side runtimes.

## Benchmark-Ready Supabase Edge Function Workflow

### Objective

Create and deploy a Supabase Edge Function for a legacy or transitional workflow while enforcing tenant context and authentication.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Function name | Implementation spec | Yes | Folder name under `supabase/functions/` |
| `SUPABASE_URL` | Supabase runtime | Yes | Provided by Supabase |
| `SUPABASE_SECRET_KEY` | Supabase secrets | Yes | Server-side only |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client auth checks | Yes | Used for `auth.getUser()` |
| `x-tenant-id` | Request header | Conditional | Required for tenant-scoped writes |

### Workflow

1. Create `supabase/functions/<name>/index.ts`.
2. Add CORS handling and method validation.
3. Validate caller with publishable key client (`auth.getUser`).
4. Use admin client with `SUPABASE_SECRET_KEY` for privileged ops.
5. Enforce tenant scope checks and `deleted_at` patterns.
6. Serve locally, then deploy and set secrets.

### Reference Implementation

```ts
// supabase/functions/content-transform/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData } = await caller.auth.getUser();
  if (!authData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, secretKey);
  const payload = await req.json();
  const tenantId = req.headers.get("x-tenant-id") ?? "";
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "Missing tenant header" }), { status: 400, headers: corsHeaders });
  }

  const { error } = await admin
    .from("blogs")
    .update({ content: payload.transformed, updated_at: new Date().toISOString() })
    .eq("id", payload.blog_id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
```

### Validation Checklist

- Function rejects unauthenticated calls.
- Privileged writes use `SUPABASE_SECRET_KEY` only.
- Tenant headers are validated for tenant-scoped operations.
- Local `supabase functions serve` matches production behavior.

### Failure Modes and Guardrails

- Missing CORS headers: browser calls fail on preflight.
- Using secret key in client: security breach.
- No `deleted_at` filter: soft-deleted rows mutated.
- Missing permission checks: add `has_permission` or admin-only routes.

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
