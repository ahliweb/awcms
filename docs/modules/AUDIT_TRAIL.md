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
| `action` | TEXT | Action type (CREATE/UPDATE/DELETE) |
| `resource` | TEXT | Table name (`TG_TABLE_NAME`) |
| `details` | JSONB | Snapshot payload (new or old row) |
| `ip_address` | TEXT | Request origin IP |
| `channel` | TEXT | web, mobile, api |
| `created_at` | TIMESTAMPTZ | Timestamp |
| `deleted_at` | TIMESTAMPTZ | Soft delete marker |

---

## Action Types

| Action | Description | Captures |
| ------ | ----------- | -------- |
| `CREATE` | New record created | details payload |
| `UPDATE` | Record modified | details payload |
| `DELETE` | Record soft-deleted | details payload |
| `RESTORE` | Record restored | details payload |
| `HARD_DELETE` | Reserved (permanent delete disabled) | details payload |
| `LOGIN` | User authentication | details payload |
| `LOGOUT` | User session ended | details payload |
| `PERMISSION_CHANGE` | Role/permission modified | details payload |
| `CONFIG_CHANGE` | System settings modified | details payload |

---

## Implementation

### Database Trigger

Audit logs are created via PostgreSQL triggers:

```sql
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id, user_id, action, resource, details, created_at
  )
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(to_jsonb(NEW), to_jsonb(OLD)),
    now()
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Applying Trigger

```sql
CREATE TRIGGER trg_articles_audit
  AFTER INSERT OR UPDATE OR DELETE ON blogs
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
```

Legacy trigger names still use the `trg_articles_audit` prefix even though they target `blogs`.

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

Audit logs are protected by Row Level Security. Current policies are tenant-scoped; admin UI permissions (`tenant.audit.read`) are enforced at the application layer.

```sql
-- Insert policy used by log_audit_event()
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND auth.uid() IS NOT NULL)
  );

-- Select policy (tenant-scoped)
CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    OR tenant_id IS NULL
  );

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
2. **Enable on Critical Tables**: blogs, users, roles, settings
3. **Monitor Log Growth**: Large tables need retention policies
4. **Index Appropriately**: Index `created_at`, `user_id`, `table_name`

---

## Related Documentation

- `docs/security/overview.md`
- `docs/security/abac.md`
- `docs/modules/MONITORING.md`

---

## Security and Compliance Notes

- Audit logs are tenant-scoped and use RLS.
- Soft delete applies where applicable.

## References

- `docs/architecture/database.md`
- `docs/security/overview.md`
