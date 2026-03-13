# Context7 Benchmark Playbook (AWCMS)

> **Documentation Authority**: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md`
>
> **Last Updated**: 2026-02-27
>
> **Primary Goal**: Improve Context7 benchmark scores by using one consistent, evidence-driven answer format.

## Purpose

Provide a single, reusable playbook for answering AWCMS benchmark prompts with structured,
logical, implementation-ready guidance.

## Audience

- Documentation maintainers
- AI agents and coding assistants
- Developers writing technical runbooks and benchmark responses

## Context7 Source Matrix

Use these Context7 libraries as the first external reference before writing or revising benchmark answers.

| Topic | Context7 Library ID | Usage in AWCMS Benchmarks |
| --- | --- | --- |
| Supabase platform | `/supabase/supabase` | RLS, onboarding, tenancy, policy design |
| Supabase JS | `/supabase/supabase-js` | Client initialization, auth, query patterns |
| Supabase CLI | `/supabase/cli` | Migration, db push/pull, function deploy workflows |
| Astro docs | `/withastro/docs` | Static output, `getStaticPaths`, build-time tenant resolution |
| React docs | `/websites/react_dev` | React 19 patterns for admin UI components |
| React Router | `/remix-run/react-router` | Route conventions and secure param patterns |
| Tailwind CSS | `/websites/tailwindcss` | Tailwind v4 usage and utility conventions |
| Framer Motion | `/grx7/framer-motion` | Motion guidance where needed |
| OpenClaw | `/openclaw/openclaw` | AI gateway and tenant-isolated AI routing |

## Canonical Answer Contract

Every benchmark response should always follow this sequence:

1. **Objective**
2. **Required Inputs**
3. **Workflow**
4. **Reference Implementation**
5. **Validation Checklist**
6. **Failure Modes and Guardrails**

## Scoring Heuristics (Practical)

- **Specificity**: Use exact keys, tables, routes, and commands from AWCMS.
- **Safety**: Include RLS, soft delete (`deleted_at`), and tenant isolation checks.
- **Executability**: Provide runnable snippets, not conceptual pseudocode.
- **Idempotency**: Handle retries and partial failures explicitly.
- **Verification**: Include deterministic tests and expected outcomes.

## Benchmark Topics (Ordered by Lowest Score First)

### 1) Tenant onboarding and isolation (83/100)

#### Objective (Tenant onboarding and isolation)

Provision a tenant through a secure, idempotent platform flow that seeds defaults and enforces
tenant isolation from first use.

#### Required Inputs (Tenant onboarding and isolation)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `actor` | `auth.getUser()` | Yes | Must hold `platform.tenant.create` |
| `name` | Onboarding payload | Yes | Tenant display name |
| `slug` | Onboarding payload | Yes | Unique tenant identifier |
| `domain` | Onboarding payload | Conditional | Required for custom-domain mode |
| `admin_email` | Onboarding payload | Yes | First tenant admin invite target |
| `SUPABASE_SECRET_KEY` | Function secret | Yes | Required for privileged provisioning |

#### Workflow (Tenant onboarding and isolation)

1. Validate authentication and `platform.tenant.create` permission.
2. Normalize and de-duplicate slug/domain on active (non-deleted) tenants.
3. Call `create_tenant_with_defaults()` with privileged client.
4. Invite first admin via `auth.admin.inviteUserByEmail` with `tenant_id` metadata.
5. Record an audit event with actor + invite status.
6. Run isolation checks (cross-tenant read denial, default seeds present).

#### Reference Implementation (Tenant onboarding and isolation)

```ts
// Worker route pattern (condensed)
const { data: canCreate } = await caller.rpc("has_permission", {
  permission_name: "platform.tenant.create",
});

const { data: tenant } = await admin.rpc("create_tenant_with_defaults", {
  p_name: payload.name,
  p_slug: payload.slug,
  p_domain: payload.domain ?? null,
});

await admin.auth.admin.inviteUserByEmail(payload.admin_email, {
  data: { tenant_id: tenant.tenant_id, role: "admin" },
});
```

#### Validation Checklist (Tenant onboarding and isolation)

- Duplicate slug onboarding returns conflict.
- New tenant has `admin`, `editor`, `author` roles and baseline content.
- Non-privileged users cannot read/write cross-tenant data.

#### Failure Modes and Guardrails (Tenant onboarding and isolation)

- Invite failure after tenant creation: return recoverable status and retry path.
- Concurrent requests: unique constraints + conflict response.
- Missing tenant context on first login: enforce profile sync checks.

### 2) New content type schema in Supabase (90/100)

#### Objective (New content type schema in Supabase)

Define a tenant-scoped content table that is query-efficient, ABAC-compatible, and RLS-safe.

#### Required Inputs (New content type schema in Supabase)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `content_type` | Product spec | Yes | Example: `events` |
| Permission prefix | ABAC matrix | Yes | Example: `tenant.events.*` |
| `tenant_id` | Tenant context | Yes | Isolation boundary |
| `author_id` | Auth user | Yes | Ownership checks |
| `deleted_at` | Table schema | Yes | Soft-delete lifecycle |

#### Workflow (New content type schema in Supabase)

1. Create timestamped migration file.
2. Define schema with tenant, workflow state, and audit timestamps.
3. Add partial unique index for tenant slug on non-deleted rows.
4. Enable RLS and add ABAC policies (`read`, `create`, `update`, `update_own`).
5. Register resource in `resources_registry` and map permissions.

#### Reference Implementation (New content type schema in Supabase)

```sql
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  author_id uuid not null references public.users(id),
  title text not null,
  slug text not null,
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists events_tenant_slug_unique
  on public.events (tenant_id, lower(slug)) where deleted_at is null;
```

#### Validation Checklist (New content type schema in Supabase)

- Cross-tenant access denied.
- Duplicate slug blocked within same tenant + active rows.
- `update_own` only edits owned rows.

#### Failure Modes and Guardrails (New content type schema in Supabase)

- Missing partial indexes causes restore collisions and slow listing.
- Missing `deleted_at` breaks soft-delete assumptions.
- Missing permission keys leads to policy lockout.

### 3) Flutter secure real-time retrieval (90/100)

#### Objective (Flutter secure real-time retrieval)

Deliver tenant-published data in near real-time with authenticated session gates and resilient fallback.

#### Required Inputs (Flutter secure real-time retrieval)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Session | Supabase Auth | Yes | Block stream when signed out |
| `tenantId` | User metadata | Yes | Do not trust UI input |
| Stream PK | `.stream(primaryKey: ['id'])` | Yes | Realtime consistency |
| Filters | Query constraints | Yes | `tenant_id`, `status='published'`, `deleted_at is null` |

#### Workflow (Flutter secure real-time retrieval)

1. Initialize Supabase Flutter client.
2. Verify session exists before starting stream.
3. Subscribe with strict tenant + published filters.
4. Fall back to one-shot fetch on stream error.
5. Render loading/error/empty/success states explicitly.

#### Reference Implementation (Flutter secure real-time retrieval)

```dart
final stream = supabase
  .from('blogs')
  .stream(primaryKey: ['id'])
  .eq('tenant_id', tenantId)
  .eq('status', 'published')
  .filter('deleted_at', 'is', null)
  .order('published_at', ascending: false);
```

#### Validation Checklist (Flutter secure real-time retrieval)

- Signed-out users do not subscribe.
- Draft rows never appear.
- Fallback query returns data if websocket fails.

#### Failure Modes and Guardrails (Flutter secure real-time retrieval)

- Tenant spoofing: derive `tenantId` from trusted session/profile.
- Realtime outage: preserve fallback data path.
- Key leakage: never use `SUPABASE_SECRET_KEY` in mobile app.

### 4) ESP32 device config push/apply (90/100)

#### Objective (ESP32 device config push/apply)

Receive, apply, and persist tenant-scoped device configuration safely, with OTA readiness.

#### Required Inputs (ESP32 device config push/apply)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Device token | Provisioning | Yes | Publishable, per-device |
| Config endpoint | Worker route URL | Yes | `/functions/v1/device-config` |
| Poll interval | Config payload | Yes | Runtime refresh cadence |
| Persistent store | Device firmware | Yes | Last-known-good fallback |

#### Workflow (ESP32 device config push/apply)

1. Boot with persisted config.
2. Poll config endpoint using bearer token.
3. Validate payload and apply hardware settings.
4. Persist updated config to local storage.
5. Trigger OTA path when remote firmware version is newer.

#### Reference Implementation (ESP32 device config push/apply)

```cpp
http.begin(CONFIG_ENDPOINT);
http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
const int code = http.GET();
if (code == 200) {
  // parse json, apply settings, persist
}
```

#### Validation Checklist (ESP32 device config push/apply)

- Device remains functional with network interruption.
- Config updates apply during next poll cycle.
- Token revocation blocks config and telemetry access.

#### Failure Modes and Guardrails (ESP32 device config push/apply)

- Malformed payload: keep previous config and log parse failure.
- Token leak: server-side revoke and rotate token.
- Breaking payload format: move to versioned endpoint.

### 5) Login and registration flow (90/100)

#### Objective (Login and registration flow)

Implement secure user sign-in and gated account onboarding with tenant-aware approvals.

#### Required Inputs (Login and registration flow)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Credentials | Login form | Yes | Email/password for admin login |
| `account_requests` | Public registration | Yes | Approval workflow storage |
| Role defaults | Roles metadata | Yes | `is_default_invite` / registration defaults |
| Invite path | Worker route | Yes | Controlled user provisioning |

#### Workflow (Login and registration flow)

1. Login with Supabase auth and reject soft-deleted users.
2. Public registration creates `pending_admin` request.
3. Tenant admin review progresses request.
4. Platform admin approval sends invite and marks complete.
5. Profile synchronization triggers create app-level user records.

#### Reference Implementation (Login and registration flow)

```javascript
await supabase.from("account_requests").insert({
  tenant_id,
  email,
  full_name,
  status: "pending_admin",
});
```

#### Validation Checklist (Login and registration flow)

- Users cannot access protected surfaces before approval/invite completion.
- Approval transitions are RBAC/ABAC controlled.
- User/profile records are created post-invite acceptance.

#### Failure Modes and Guardrails (Login and registration flow)

- Direct privileged account creation from client must be blocked.
- Missing role defaults can create assignment drift.
- Status update paths require strict RLS.

### 6) Cloudflare Worker deployment (91/100)

#### Objective (Cloudflare Worker deployment)

Build and deploy secure server-side logic with strict key separation and tenant enforcement.

#### Required Inputs (Cloudflare Worker deployment)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Function source | `awcms-edge/src/index.ts` | Yes | Canonical Worker route location |
| `SUPABASE_URL` | Runtime env | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Runtime env | Yes | Caller auth validation |
| `SUPABASE_SECRET_KEY` | Runtime env | Yes | Privileged mutations only |

#### Workflow (Cloudflare Worker deployment)

1. Implement function with CORS and method checks.
2. Authenticate caller with publishable-key client.
3. Run privileged writes with secret-key admin client.
4. Validate tenant context for tenant-scoped operations.
5. Run the Worker locally and test the route.
6. Deploy the Worker and set secrets through Wrangler.

#### Reference Implementation (Cloudflare Worker deployment)

```bash
cd awcms-edge
cp .dev.vars.example .dev.vars
npm run dev:local
npx wrangler secret put SUPABASE_SECRET_KEY
npm run deploy
```

#### Validation Checklist (Cloudflare Worker deployment)

- Unauthorized calls are rejected.
- Secret key is never exposed to client runtime.
- Tenant checks are enforced before data mutation.

#### Failure Modes and Guardrails (Cloudflare Worker deployment)

- Missing CORS breaks browser invocation.
- Mixed key usage causes privilege escalation risk.
- Missing soft-delete filter mutates retired rows.

### 7) Monorepo versioning and independent deploy strategy (92/100)

#### Objective (Monorepo versioning and independent deploy strategy)

Ship independent client releases safely while preserving cross-client compatibility.

#### Required Inputs (Monorepo versioning and independent deploy strategy)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| App version files | package manifests | Yes | Per-app semantic versioning |
| CI path filters | Workflow files | Yes | Deploy only changed surfaces |
| Additive schema policy | Migration standards | Yes | Backward compatibility guardrail |

#### Workflow (Monorepo versioning and independent deploy strategy)

1. Make backend changes additive first.
2. Bump only affected client versions.
3. Deploy in sequence: DB/functions -> admin -> public -> mobile -> IoT.
4. Maintain compatibility window until slow clients upgrade.

#### Reference Implementation (Monorepo versioning and independent deploy strategy)

```bash
npm version minor --prefix awcms
npm version patch --prefix awcms-public/primary
```

#### Validation Checklist (Monorepo versioning and independent deploy strategy)

- Unchanged apps are not rebuilt/deployed.
- Older mobile/IoT clients continue to function during staged rollout.
- Changelog accurately records versioned changes.

#### Failure Modes and Guardrails (Monorepo versioning and independent deploy strategy)

- Breaking endpoint changes must be versioned.
- Schema rollbacks should prefer roll-forward hotfix migrations.
- Mobile rollback requires OTA/store strategy planning.

### 8) Fine-grained authorization beyond basic RLS (95/100)

#### Objective (Fine-grained authorization beyond basic RLS)

Map ABAC permissions to enforceable RLS policies with tenant and ownership constraints.

#### Required Inputs (Fine-grained authorization beyond basic RLS)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Permission keys | `permissions` table | Yes | `scope.resource.action` format |
| Role links | `role_permissions` | Yes | Core ABAC mapping |
| Tenant resolver | `current_tenant_id()` | Yes | Isolation baseline |
| Ownership field | Target table | Conditional | For `*_own` policies |

#### Workflow (Fine-grained authorization beyond basic RLS)

1. Normalize permission keys in DB and frontend.
2. Implement `has_permission` and use `auth_is_admin` where recursion-safe bypass is needed.
3. Compose RLS with tenant + permission + ownership checks.
4. Keep frontend checks as UX-only hints.

#### Reference Implementation (Fine-grained authorization beyond basic RLS)

```sql
create policy blogs_update_policy on public.blogs
for update using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and (
    public.has_permission('tenant.blog.update')
    or (
      public.has_permission('tenant.blog.update_own')
      and author_id = auth.uid()
    )
  )
);
```

#### Validation Checklist (Fine-grained authorization beyond basic RLS)

- API-level bypass attempts fail under RLS.
- `update_own` users cannot edit non-owned rows.
- Cross-tenant reads and writes are denied.

#### Failure Modes and Guardrails (Fine-grained authorization beyond basic RLS)

- Permission drift (`edit_blog` vs `tenant.blog.update`) causes policy mismatch.
- Frontend-only checks create false security assumptions.
- Guessable identifiers require signed route params.

### 9) Astro static content fetching (96/100)

#### Objective (Astro static content fetching)

Generate tenant-scoped static pages with published-only content and deterministic build outputs.

#### Required Inputs (Astro static content fetching)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `PUBLIC_TENANT_ID` | Build env | Yes | Primary static tenant resolver |
| Supabase publishable keys | Build env | Yes | Use `VITE_*`/`PUBLIC_*` fallbacks |
| Query filters | Fetch layer | Yes | Published + non-deleted constraints |

#### Workflow (Astro static content fetching)

1. Resolve tenant at build time.
2. Create tenant-scoped Supabase client headers.
3. Fetch published records and generate route params.
4. Render static pages from fetched data.

#### Reference Implementation (Astro static content fetching)

```ts
export async function getStaticPaths() {
  const tenantId = import.meta.env.PUBLIC_TENANT_ID;
  const supabase = createClientFromEnv(import.meta.env, { "x-tenant-id": tenantId });
  const { data } = await supabase
    .from("blogs")
    .select("slug")
    .eq("status", "published")
    .is("deleted_at", null);
  return (data ?? []).map((row) => ({ params: { slug: row.slug } }));
}
```

#### Validation Checklist (Astro static content fetching)

- Builds do not depend on runtime-only tenant context.
- Draft content is excluded.
- Generated slug paths are complete and tenant-safe.

#### Failure Modes and Guardrails (Astro static content fetching)

- Missing tenant env variable causes wrong/empty output.
- Runtime middleware assumptions do not apply to static builds.
- Unfiltered status/deleted fields can leak hidden content.

### 10) Admin tenant content form (97/100)

#### Objective (Admin tenant content form)

Implement a reliable React form for tenant-scoped draft creation with robust permission and error handling.

#### Required Inputs (Admin tenant content form)

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenantId` | `useTenant()` | Yes | Required before submit |
| Permission | `usePermissions()` | Yes | `tenant.blog.create` |
| Auth user | `supabase.auth.getUser()` | Yes | Source for `author_id` |
| Toast handling | UI layer | Yes | Explicit success/failure feedback |

#### Workflow (Admin tenant content form)

1. Guard submit on missing tenant context.
2. Guard submit on missing permission.
3. Resolve authenticated user.
4. Insert payload with `status: 'draft'`.
5. Handle unique violations and show descriptive toasts.

#### Reference Implementation (Admin tenant content form)

```javascript
const { error } = await supabase.from("blogs").insert({
  tenant_id: tenantId,
  author_id: currentUser.id,
  title,
  content,
  slug: toSlug(title),
  status: "draft",
});
```

#### Validation Checklist (Admin tenant content form)

- Missing tenant context blocks submit.
- Missing permission blocks submit.
- Duplicate slug errors are user-friendly and explicit.

#### Failure Modes and Guardrails (Admin tenant content form)

- Hardcoded `tenant_id` causes data leakage risk.
- Direct publish on create bypasses workflow controls.
- Silent failures degrade trust and operator diagnostics.

## Reusable Response Template (Copy/Paste)

Use this template whenever a new benchmark prompt is added:

````md
## <Prompt Title> (<score>/100)

### Objective (<Prompt Title>)
<single-sentence implementation goal>

### Required Inputs (<Prompt Title>)
| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

### Workflow (<Prompt Title>)
1. ...
2. ...
3. ...

### Reference Implementation (<Prompt Title>)
```<language>
<runnable snippet>
```

### Validation Checklist (<Prompt Title>)
- ...
- ...

### Failure Modes and Guardrails (<Prompt Title>)
- **Failure:** ... **Guardrail:** ...
````

## Maintenance Rules

- Update this playbook before editing scattered docs when benchmark scores regress.
- Keep examples aligned with current stack versions and env keys:
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY`
- Keep all benchmark examples explicit on tenant isolation and soft delete semantics.
- Verify with markdown lint and link checks before merge.

## References

- `AGENTS.md`
- `docs/dev/documentation-audit-plan.md`
- `docs/dev/documentation-audit-tracker.md`
- `docs/tenancy/overview.md`
- `docs/security/abac.md`
- `docs/security/rls.md`
