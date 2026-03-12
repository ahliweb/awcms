> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 3 (Modules)

# Email Integration (Mailketing)

## Purpose

Document the Mailketing integration used for transactional email.

## Audience

- Admin panel developers
- Operators configuring edge runtimes

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for email integration patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Cloudflare Workers configured for the current mail pipeline
- `docs/tenancy/supabase.md`

## Core Concepts

- Mailketing is invoked via the Cloudflare Worker API in `awcms-edge/`.
- Email logs are stored in `email_logs` with tenant scoping.

## How It Works

### Configuration

Set secrets in the active edge runtime:

```shell
MAILKETING_API_TOKEN=...
MAILKETING_DEFAULT_LIST_ID=1
```

Set Worker secrets through Wrangler for the maintained deployment path:

```bash
cd awcms-edge
npx wrangler secret put MAILKETING_API_TOKEN
npx wrangler secret put MAILKETING_DEFAULT_LIST_ID
```

### Deploy Edge Handler

```bash
npx wrangler deploy --cwd awcms-edge
```

For local development, run the Worker with the admin env file:

```bash
cd awcms-edge
npm run dev:local
```

## Implementation Patterns

```javascript
import { sendEmail } from '@/lib/email/mailketingService';

await sendEmail({
  to: 'user@example.com',
  subject: 'Welcome',
  content: '<p>Welcome to AWCMS</p>'
});
```

## Permissions and Access

- UI actions that trigger email must be permission-gated.

## Security and Compliance Notes

- Do not expose Mailketing secrets in client code.
- Soft delete applies to `email_logs`.
- Use `SUPABASE_SECRET_KEY` only inside approved server-side edge runtimes.

## References

- `docs/tenancy/supabase.md`
- `awcms/src/lib/email/mailketingService.js`
