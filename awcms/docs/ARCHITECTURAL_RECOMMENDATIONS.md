# Architectural Recommendations

## Purpose
Provide architectural guidance for AWCMS development derived from audits and best practices.

## Audience
- Engineers implementing new modules
- Reviewers assessing architectural changes

## Prerequisites
- `awcms/docs/00-core/CORE_STANDARDS.md`

This document provides architectural guidance for AWCMS development, derived from system audits and best practices.

---

## 1. Core Architectural Principles

### 1.1 Multi-Tenancy First

Every feature MUST be designed with multi-tenancy in mind:

- **Database**: All tables MUST include `tenant_id` column
- **RLS**: Every table MUST have Row Level Security policies
- **Queries**: Application code MUST filter by `tenant_id`
- **Storage**: Media assets MUST be organized by tenant

### 1.2 Performance & Caching Architecture

The Unified Data Manager (UDM) implements a 'Stale-While-Revalidate' inspired caching strategy using Local Storage:

```text
┌─────────────────────────────────────────────────────────────┐
│                    UnifiedDataManager                       │
├─────────────────────────────────────────────────────────────┤
│  Request ──► Check Cache (LocalStorage) ──► Hit (< 60s)     │
│       │                                     │               │
│       └──► Miss/Expired ──► Supabase ──► Update Cache       │
└─────────────────────────────────────────────────────────────┘
```

**Key Principles:**

1. **Read-Heavy Optimization**: Reads are cached for 60 seconds by default.
2. **Write-Through Invalidation**: ALL writes (insert/update/delete) immediately invalidate the table's cache to ensure consistency.
3. **Stable Keys**: Cache keys are generated based on query params (filters, sorts, columns).

### 1.3 Security by Default

Apply Zero Trust principles:

1. **Never trust client input** - Validate all data server-side
2. **Always use parameterized queries** - Prevent SQL injection
3. **Enforce RLS everywhere** - Database is the last line of defense
4. **Audit sensitive actions** - Log who, what, when, where

---

## 2. Component Architecture

### 2.1 Dashboard Components

Follow the standardized pattern for admin modules:

```jsx
// Standard Manager Component Structure
function ModuleManager() {
  // 1. Permission check
  const { hasPermission } = usePermissions();
  
  // 2. Data fetching with tenant context
  const { data, loading } = useModuleData();
  
  // 3. Breadcrumb navigation
   <Breadcrumb items={[{ label: 'Dashboard' }, { label: 'Module' }]} />
  
  // 4. Content area with loading states
  if (loading) return <Skeleton />;
  
  // 5. Main content with actions
  return <DataTable data={data} actions={...} />;
}
```

### 2.2 Hook Architecture

Custom hooks should follow this pattern:

- **Single Responsibility**: One hook per domain (e.g., `useArticles`, `useUsers`)
- **Return Standardized Object**: `{ data, loading, error, actions }`
- **Include CRUD Operations**: `create`, `update`, `delete`, `fetch`
- **Handle Tenant Context**: Automatically scope to current tenant

---

## 3. Extension System Guidelines

### 3.1 Core Plugins vs External Extensions

| Type | Location | Loading | Use Case |
| :--- | :--- | :--- | :--- |
| Core Plugin | `src/plugins/` | Bundled | Essential features |
| External Extension | `awcms-ext-*/` | Dynamic | Optional add-ons |

### 3.2 Extension Manifest

Every extension MUST include a `plugin.json`:

```json
{
  "id": "vendor-extension-name",
  "name": "Extension Name",
  "version": "1.0.0",
  "author": "Vendor Name",
  "description": "Brief description",
  "permissions": ["read:articles", "write:articles"],
  "menuItems": [],
  "routes": []
}
```

---

## 4. Performance Recommendations

### 4.1 Code Splitting

Use dynamic imports for large components:

```javascript
const HeavyComponent = lazy(() => import('./HeavyComponent'));
```

### 4.2 Query Optimization

- **Limit result sets**: Never fetch unlimited rows
- **Use pagination**: Implement cursor-based pagination
- **Select specific columns**: Avoid `SELECT *`
- **Cache frequently accessed data**: Use React Query or similar

### 4.3 Bundle Size

Target bundle sizes:

| Bundle | Max Size (gzip) |
| :--- | :--- |
| vendor-react | 60 KB |
| vendor-ui | 120 KB |
| index (app) | 200 KB |

---

## 5. Testing Requirements

### 5.1 Minimum Coverage

| Area | Requirement |
| :--- | :--- |
| Permission Logic | Unit tests required |
| Data Layer | Unit tests required |
| API Integration | Integration tests recommended |
| Critical Flows | E2E tests recommended |

### 5.2 Test Naming Convention

```javascript
describe('ComponentName', () => {
  it('should [expected behavior] when [condition]', () => {
    // ...
  });
});
```

---

## 6. Documentation Standards

### 6.1 Code Comments

- **Complex Logic**: Explain WHY, not WHAT
- **Public APIs**: JSDoc for exported functions
- **Workarounds**: Link to issue tracker

### 6.2 Documentation Files

All new features MUST include:

1. Update to relevant `docs/` subdirectory file
2. Entry in `CHANGELOG.md`
3. Update to `docs/INDEX.md` if new doc created

---

## Related Documents

- [CORE_STANDARDS.md](00-core/CORE_STANDARDS.md) - Definitive standards
- [AGENTS.md](../../AGENTS.md) - AI development guidelines
- [PERFORMANCE.md](03-features/PERFORMANCE.md) - Performance optimization
- [SECURITY.md](00-core/SECURITY.md) - Security implementation

---

## References

- `../00-core/CORE_STANDARDS.md`
- `../03-features/PERFORMANCE.md`
