# Monitoring & Logging

This guide covers monitoring, logging, and observability for AWCMS.

---

## Supabase Dashboard

### Built-in Monitoring

Access via: `https://supabase.com/dashboard/project/{project-id}/reports`

| Report | Description |
|--------|-------------|
| **API Requests** | Request count, latency, error rates |
| **Database** | Query performance, connection pooling |
| **Auth** | Sign-in attempts, failures, MFA usage |
| **Storage** | Bandwidth, file counts, egress |
| **Realtime** | Active connections, message throughput |

### Query Performance

Monitor slow queries in Database > Query Performance:

- Filter by execution time
- Identify N+1 patterns
- Add missing indexes

---

## Application Logging

### Browser Console

Development logs are output to browser console:

```javascript
console.log('[AWCMS]', 'Module loaded:', moduleName);
console.error('[AWCMS Error]', error.message);
```

### Structured Logging

For production, use structured logging:

```javascript
const log = (level, message, context = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };
  console[level](JSON.stringify(entry));
};

log('info', 'User logged in', { userId: user.id, tenantId });
```

---

## Error Tracking

### Sentry Integration (Optional)

```javascript
// src/lib/sentry.js
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [new Sentry.BrowserTracing()],
  tracesSampleRate: 0.1,
});

// Capture errors
Sentry.captureException(error);
```

### Error Boundary

React Error Boundary catches component errors:

```jsx
import { ErrorBoundary } from '@sentry/react';

<ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</ErrorBoundary>
```

---

## Audit Trail

### Database Audit Logs

The `audit_logs` table tracks critical actions:

| Column | Description |
|--------|-------------|
| `id` | Unique identifier |
| `user_id` | Who performed the action |
| `action` | Action type (create, update, delete) |
| `table_name` | Affected table |
| `record_id` | Affected record |
| `old_value` | Previous state (JSONB) |
| `new_value` | New state (JSONB) |
| `ip_address` | Request origin |
| `channel` | web, mobile, api |
| `created_at` | Timestamp |

### Viewing Audit Logs

Access via Admin Panel: `/cmspanel/audit-logs`

Features:

- Filter by user, action, table
- Date range selection
- Diff viewer for old/new values

---

## Health Checks

### Simple Health Check

```javascript
// Edge Function: /functions/health
export default async () => {
  const { error } = await supabase.from('tenants').select('id').limit(1);
  return new Response(
    JSON.stringify({ status: error ? 'unhealthy' : 'healthy' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
```

### Dashboard Health Indicator

The Admin Panel shows connection status in the header.

---

## Alerting

### Supabase Alerts

Configure in Dashboard > Settings > Alerts:

- High error rate
- Database connection saturation
- Storage quota warnings

### External Alerting

Integrate with:

- PagerDuty
- Slack webhooks
- Email notifications

```javascript
// Example: Slack webhook on critical error
await fetch(SLACK_WEBHOOK_URL, {
  method: 'POST',
  body: JSON.stringify({
    text: `🚨 Critical Error: ${error.message}`,
    channel: '#alerts'
  })
});
```

---

## Performance Metrics

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Latency (p50) | < 100ms | > 500ms |
| API Latency (p99) | < 500ms | > 2000ms |
| Error Rate | < 0.1% | > 1% |
| Database Connections | < 80% | > 90% |

### Logging Levels

| Level | Usage |
|-------|-------|
| `error` | Unrecoverable errors |
| `warn` | Potential issues |
| `info` | Important events |
| `debug` | Development details |

---

## Checklist

- [ ] Supabase Dashboard configured
- [ ] API request monitoring enabled
- [ ] Query performance reviewed
- [ ] Error tracking integrated
- [ ] Audit logs accessible
- [ ] Health check endpoint working
- [ ] Alerting configured
