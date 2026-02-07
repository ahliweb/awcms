> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 3 (Modules)

# Email Integration (Mailketing)

## Purpose

Document the Mailketing integration used for transactional email.

## Audience

- Admin panel developers
- Operators configuring Edge Functions

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for email integration patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- Supabase Edge Functions enabled
- `docs/tenancy/supabase.md`

## Core Concepts

- Mailketing is invoked via a Supabase Edge Function.
- Email logs are stored in `email_logs` with tenant scoping.

## How It Works

### Configuration

Set secrets in Supabase (Edge Functions):

```shell
MAILKETING_API_TOKEN=...
MAILKETING_DEFAULT_LIST_ID=1
```

### Deploy Function

```bash
npx supabase functions deploy mailketing
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

## References

- `docs/tenancy/supabase.md`
- `awcms/src/lib/email/mailketingService.js`
