> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Supabase Edge Functions

## 1. Overview

AWCMS uses **Supabase Edge Functions** (Deno TypeScript, V8 Isolates) for server-side operations that:

- Require the **service role (secret) key** — never exposable to the browser or mobile app.
- Enforce privileged business logic (e.g., sending emails, triggering webhooks, IoT config serving).
- Serve as the secure API bridge for mobile / ESP32 devices.

All functions live in `awcms/supabase/functions/`.

---

## 2. Project Structure

```text
awcms/supabase/functions/
├── _shared/
│   ├── cors.ts           # Shared CORS headers
│   └── auth.ts           # JWT verification helper
├── device-config/        # IoT configuration endpoint
│   └── index.ts
├── send-email/           # Transactional email via Resend
│   └── index.ts
└── content-webhook/      # Notify external systems on publish
    └── index.ts
```

---

## 3. Core Boilerplate (`_shared/`)

### `_shared/cors.ts`

```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, Content-Type',
};
```

### `_shared/auth.ts`

```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,  // Only available server-side
  );
}

/** Verify caller's JWT and return the authenticated user */
export async function verifyUser(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) throw new Error('Missing Authorization header');

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
  );

  const { data: { user }, error } = await client.auth.getUser(jwt);
  if (error || !user) throw new Error('Unauthorized');
  return user;
}
```

---

## 4. Example: Device Configuration Endpoint

This function is polled by ESP32 devices. It validates a device token and returns the current configuration stored in the `iot_device_configs` table.

```typescript
// supabase/functions/device-config/index.ts
import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const deviceToken = authHeader.replace('Bearer ', '');
    const admin = getAdminClient();

    // Validate device token against the registry
    const { data: device, error } = await admin
      .from('iot_devices')
      .select('id, tenant_id, config')
      .eq('publishable_token', deviceToken)
      .eq('is_active', true)
      .single();

    if (error || !device) {
      return new Response(JSON.stringify({ error: 'Device not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Return device-specific configuration
    return new Response(JSON.stringify(device.config), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

---

## 5. Example: Transactional Email (`send-email`)

Triggered after content is published, sends a notification to subscribers using the Resend API.

```typescript
// supabase/functions/send-email/index.ts
import { corsHeaders } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    await verifyUser(req);  // Only authenticated AWCMS users can trigger emails

    const payload: EmailPayload = await req.json();

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@awcms.example.com',
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });

    const result = await res.json();
    return new Response(JSON.stringify(result), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

---

## 6. Local Development

```bash
# Serve all functions locally (hot-reload)
supabase functions serve --env-file awcms/.env.local

# Serve a specific function
supabase functions serve device-config --env-file awcms/.env.local

# Test with curl
curl -i http://localhost:54321/functions/v1/device-config \
  -H "Authorization: Bearer sb_publishable_test_..."
```

---

## 7. Deployment

```bash
# Deploy a single function
supabase functions deploy device-config --project-ref <project_ref>

# Deploy all functions
supabase functions deploy --project-ref <project_ref>

# Set required secrets
supabase secrets set RESEND_API_KEY=re_... --project-ref <project_ref>
```

GitHub Actions deploys functions automatically on push to `main`. See [`docs/dev/ci-cd.md`](ci-cd.md).

---

## 8. Required Secrets (Supabase Dashboard / CLI)

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Auto-injected by the runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected; use via `Deno.env.get()` |
| `SUPABASE_PUBLISHABLE_KEY` | For client-facing auth validation |
| `RESEND_API_KEY` | Email sending (Resend.com) |

> **[!CAUTION]**
> `SUPABASE_SERVICE_ROLE_KEY` is automatically available inside Edge Functions. Never include it in client-side code or response bodies.
