# Audit Trail System

## Purpose

Document audit logging behavior and schema usage.

## Audience

- Admin panel developers
- Compliance and security reviewers

## Prerequisites

- `docs/security/overview.md`

AWCMS implements comprehensive audit logging for compliance and security monitoring.

---

## Overview

The audit trail captures all significant system actions, providing:

- **Who** performed the action (user_id)
- **What** action was performed (action type)
- **Where** the action occurred (table, record, channel)
- **When** the action happened (timestamp)
- **How** the data changed (before/after snapshots)

---

## Database Schema

### audit_logs Table

| Column | Type | Description |
| ------ | ---- | ----------- |
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant isolation |
| `user_id` | UUID | User who performed action |
| `action` | TEXT | Action type (create, update, delete, etc.) |
| `table_name` | TEXT | Affected table |
| `record_id` | UUID | Affected record ID |
| `old_value` | JSONB | Previous state (for updates) |
| `new_value` | JSONB | New state (for creates/updates) |
| `ip_address` | TEXT | Request origin IP |
| `user_agent` | TEXT | Browser/client info |
| `channel` | TEXT | web, mobile, api |
| `created_at` | TIMESTAMPTZ | Timestamp |

---

## Action Types

| Action | Description | Captures |
| ------ | ----------- | -------- |
| `create` | New record created | new_value |
| `update` | Record modified | old_value, new_value |
| `delete` | Record soft-deleted | old_value |
| `restore` | Record restored | old_value, new_value |
| `hard_delete` | Reserved (permanent delete disabled) | old_value |
| `login` | User authentication | user details |
| `logout` | User session ended | - |
| `permission_change` | Role/permission modified | old_value, new_value |
| `config_change` | System settings modified | old_value, new_value |

---

## Implementation

### Database Trigger

Audit logs are created via PostgreSQL triggers:

```sql
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id, user_id, action, table_name, 
    record_id, old_value, new_value
  )
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) 
         WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) 
         ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL 
         ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Applying Trigger

```sql
CREATE TRIGGER audit_articles
  AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
```

---

## Frontend Viewing

### Audit Logs Page

Access via Admin Panel: `/cmspanel/audit-logs`

Features:

- **Filters**: User, action, table, date range
- **Diff Viewer**: Side-by-side comparison of old/new values
- **Export**: CSV/JSON download for compliance

### API Usage

```javascript
const { data: logs } = await supabase
  .from('audit_logs')
  .select('*, user:users(email)')
  .order('created_at', { ascending: false })
  .limit(100);
```

---

## RLS Policies

Audit logs are protected by Row Level Security:

```sql
-- Only Admin+ can view audit logs within their tenant
CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT USING (
    tenant_id = current_tenant_id() 
    AND is_admin_or_above()
  );

-- Platform admins can view all logs
CREATE POLICY "audit_select_platform" ON audit_logs
  FOR SELECT USING (is_platform_admin());

-- No direct modifications (insert only via triggers)
```

---

## Retention Policy

### Default Retention

- Production: 365 days
- Development: 30 days

### Cleanup Job

```sql
-- Run periodically via pg_cron
DELETE FROM audit_logs 
WHERE created_at < NOW() - INTERVAL '365 days';
```

---

## Compliance Features

### GDPR Support

- Export user activity on request
- Anonymize user data after deletion
- Track data access for reporting

### SOC 2 Alignment

- Immutable log entries
- Timestamp integrity
- Access controls on log viewing

---

## Best Practices

1. **Don't Log Sensitive Data**: Exclude passwords, tokens in new_value
2. **Enable on Critical Tables**: articles, users, roles, settings
3. **Monitor Log Growth**: Large tables need retention policies
4. **Index Appropriately**: Index `created_at`, `user_id`, `table_name`

---

## Related Documentation

- [Security](docs/security/overview.md)
- [ABAC System](ABAC_SYSTEM.md)
- [Monitoring](MONITORING.md)

---

## Security and Compliance Notes

- Audit logs are tenant-scoped and use RLS.
- Soft delete applies where applicable.

## References

- `../02-reference/DATABASE_SCHEMA.md`
- `docs/security/overview.md`
