# Email Integration Documentation

## Mailketing Integration

AWCMS integrates with [Mailketing](https://mailketing.co.id) for transactional emails and subscriber management.

---

## Setup

### 1. Get API Token

1. Login to [Mailketing Dashboard](https://be.mailketing.co.id/login)
2. Go to **Integration** menu
3. Copy your **API Token**

### 2. Configure Environment

Add to Supabase project secrets (Dashboard > Project Settings > Edge Functions > Secrets):

```
MAILKETING_API_TOKEN=your-api-token
MAILKETING_DEFAULT_LIST_ID=1
```

### 3. Deploy Edge Functions

```bash
npx supabase functions deploy mailketing
npx supabase functions deploy mailketing-webhook
```

### 4. Configure Webhook (Optional)

1. Go to Mailketing Dashboard > Integration > Webhook
2. Add webhook URL: `https://your-project.supabase.co/functions/v1/mailketing-webhook`

---

## API Usage

### Send Email

```javascript
import { sendEmail } from '@/lib/email/mailketingService';

await sendEmail({
    to: 'user@example.com',
    subject: 'Welcome to AWCMS',
    content: '<h1>Welcome!</h1><p>Your account is ready.</p>',
    fromName: 'AWCMS',
    fromEmail: 'noreply@awcms.com',
});
```

### Add Subscriber

```javascript
import { addSubscriber } from '@/lib/email/mailketingService';

await addSubscriber({
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    listId: 1,
});
```

### Check Credits

```javascript
import { checkCredits } from '@/lib/email/mailketingService';

const result = await checkCredits();
console.log(result.credits); // "1234"
```

### Get Mailing Lists

```javascript
import { getLists } from '@/lib/email/mailketingService';

const result = await getLists();
console.log(result.lists); // [{ list_id: 1, list_name: "Newsletter" }]
```

---

## Webhook Events

The webhook handler logs these events to `email_logs` table:

| Event | Description |
| ----- | ----------- |
| `subscribed` | New subscriber added to list |
| `unsubscribed` | User unsubscribed |
| `opened` | Email was opened |
| `clicked` | Link in email was clicked |
| `bounced` | Email bounced (invalid address) |

---

## Database Tables

### email_logs

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | UUID | Primary key |
| tenant_id | UUID | Tenant isolation |
| event_type | TEXT | sent, opened, clicked, bounced, etc. |
| recipient | TEXT | Email address |
| subject | TEXT | Email subject |
| metadata | JSONB | Additional event data |
| created_at | TIMESTAMPTZ | Timestamp |

---

## Best Practices

1. **Use Templates**: Create email templates in Mailketing for consistent branding
2. **Monitor Credits**: Check credit balance regularly
3. **Handle Bounces**: Update user records when emails bounce
4. **Segment Lists**: Use different lists for different purposes

---

## Related Documentation

- [Mailketing API Docs](https://mailketing.co.id/docs-kategori/api/)
- [Configuration](../01-guides/CONFIGURATION.md)
- [Cloudflare Deployment](../01-guides/CLOUDFLARE_DEPLOYMENT.md)
