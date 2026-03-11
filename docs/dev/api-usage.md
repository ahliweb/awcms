> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2 (Data Integrity)

# API Documentation

## Purpose

Document how AWCMS uses the Supabase client APIs for data, auth, storage, and edge-facing integrations.

## Audience

- Admin and public portal developers
- Integrators building extensions

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for API patterns and Supabase integration
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/tenancy/supabase.md`
- `docs/architecture/database.md`

## Reference

### Client Initialization (Admin)

```javascript
import { supabase } from '@/lib/customSupabaseClient';
```

**Context7 note**: Supabase clients should be initialized with PKCE flow, session persistence, and global headers.

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: { 'x-application-name': 'awcms' },
  },
});
```

### Client Initialization (Public)

```ts
import { createScopedClient } from '../lib/supabase';

const supabase = createScopedClient({ 'x-tenant-id': tenantId }, runtimeEnv);
```

> **Vite Env Reminder**: Only `VITE_`-prefixed variables are exposed to client code. Use `loadEnv` in `vite.config` when config values must read non-prefixed keys.

### Authentication

```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'securepassword'
});
```

### Data Access

```javascript
const { data, error } = await supabase
  .from('blogs')
  .select('*, author:users(id, full_name)')
  .eq('status', 'published')
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

### Soft Delete

```javascript
const { error } = await supabase
  .from('blogs')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', blogId);
```

### Storage Upload

```javascript
const { data, error } = await supabase.storage
  .from('cms-uploads')
  .upload(`images/${fileName}`, file, { cacheControl: '3600', upsert: false });
```

### Edge Logic

```javascript
const { data: { session } } = await supabase.auth.getSession();

const response = await fetch(`${import.meta.env.VITE_EDGE_URL}/api/mailketing`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ action: 'send', recipient: 'user@example.com' })
});

const data = await response.json();
```

## Security and Compliance Notes

- Always filter `deleted_at IS NULL` for reads.
- Tenant-scoped tables must be filtered by tenant and RLS enforced.
- Secret keys may be used only in Cloudflare Workers, migrations, and trusted operational scripts.
- Admin client injects `x-tenant-id` automatically via `customSupabaseClient`.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/architecture/database.md`
