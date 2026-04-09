> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Email Integration (Mailketing)

## Purpose

Document the current Mailketing integration in AWCMS: where the maintained email/runtime boundary lives, how send actions are authorized, and how Mailketing relates to notification/email history surfaces.

## Current Email Integration Model

Mailketing is currently integrated through the Cloudflare Worker runtime in `awcms-edge/`.

Current practical split:

- admin/public clients invoke maintained Worker routes
- Worker code holds Mailketing secrets and operational logic
- email/notification history is reflected in the appropriate database-backed logs/history tables

Current important rule:

- Mailketing is not a client-side direct integration and should not be documented that way

## Current Runtime Boundary

Current maintained routes include:

- `/api/mailketing`
- `/functions/v1/mailketing`
- `/functions/v1/mailketing-webhook`

These are Worker-backed compatibility/runtime aliases, not a recommendation to rely on Supabase-hosted function URLs.

## Current `send` Guardrails

The `send` action is no longer a loose anonymous action.

Current guardrails:

- `send` requires bearer auth
- `send` requires tenant context aligned with the authenticated user’s scope
- notification send/manage permission boundaries still apply
- non-send actions may have different trust boundaries; check the current route contract before copying examples

## Current Configuration Model

Mailketing secrets belong in the active Worker runtime configuration.

Representative current env/secrets:

```text
MAILKETING_API_TOKEN
MAILKETING_DEFAULT_LIST_ID
```

Maintained deployment path:

```bash
cd awcms-edge
npx wrangler secret put MAILKETING_API_TOKEN
npx wrangler secret put MAILKETING_DEFAULT_LIST_ID
```

For local development, use the current `.dev.vars` flow in `awcms-edge/`.

## Current Client Invocation Pattern

Representative current pattern:

```javascript
const response = await fetch(`${edgeUrl}/api/mailketing`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    'x-tenant-id': tenantId,
  },
  body: JSON.stringify({
    action: 'send',
    recipient: 'user@example.com',
    subject: 'Welcome',
    content: '<p>Welcome to AWCMS</p>',
  }),
});
```

Current important note:

- documented client examples should point at the Worker runtime and should include tenant/auth context for `send`

## Current Logging / History Surfaces

Mailketing activity is part of the broader notification/email operational surface.

Current practical guidance:

- use the current email/notification log/history surfaces rather than implying a standalone Mailketing-only datastore is the authoritative audit source
- route failures, webhook handling, and notification dispatch results belong to the broader observability model documented elsewhere

## Current Security Notes

- never expose Mailketing secrets in client code
- keep `SUPABASE_SECRET_KEY` server-side only
- keep tenant scoping explicit in email-triggering flows
- do not describe `send` as a public anonymous operation

## Validation Guidance

| Surface | Validation |
| --- | --- |
| Worker/mail integration changes | `cd awcms-edge && npm test && npm run typecheck` |
| maintained docs | `cd awcms && npm run docs:check` |
| route catalog/OpenAPI contract changes | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` when relevant |

## Related Docs

- [docs/dev/edge-functions.md](../dev/edge-functions.md)
- [docs/dev/api-usage.md](../dev/api-usage.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/modules/MONITORING.md](./MONITORING.md)
