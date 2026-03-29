---
description: RLS and ABAC policy change procedure with verification
---

# RLS Change Workflow

## Steps

1. **Document the change** — State which table, which operation (SELECT/INSERT/UPDATE), and what the policy should enforce. Cross-reference `.agents/rules/abac-enforcer.md`.

2. **Plan mode** — This is a HIGH-RISK change. Explain the approach before writing SQL.

3. **Create migration** — Use the migration workflow (`.agents/workflows/migration-workflow.md`)

4. **Write policy SQL** — Follow these patterns:

   ```sql
   -- SELECT: tenant + soft delete filter
   CREATE POLICY <table>_select_policy ON public.<table>
   FOR SELECT USING (
     tenant_id = public.current_tenant_id()
     AND deleted_at IS NULL
   );

   -- INSERT: tenant + permission + author
   CREATE POLICY <table>_insert_policy ON public.<table>
   FOR INSERT WITH CHECK (
     tenant_id = public.current_tenant_id()
     AND author_id = auth.uid()
     AND public.has_permission('scope.resource.create')
   );
   ```

5. **Add permission key** (if new):

   ```sql
   INSERT INTO permissions (key, description, scope)
   VALUES ('scope.resource.action', 'Description', 'scope')
   ON CONFLICT (key) DO NOTHING;
   ```

6. **Assign to roles**:

   ```sql
   INSERT INTO role_permissions (role_id, permission_id)
   SELECT r.id, p.id FROM roles r, permissions p
   WHERE r.name = 'editor' AND p.key = 'scope.resource.action'
   ON CONFLICT DO NOTHING;
   ```

7. **Add UI permission check** in relevant component:

   ```javascript
   const { hasPermission } = usePermissions();
   if (!hasPermission('scope.resource.action')) return null;
   ```

8. **Run audit queries** from `.agents/rules/rls-policy-auditor.md`

9. **Test cross-tenant** — Verify User A (tenant 1) cannot see/modify User B (tenant 2) data

10. **Update docs** — `docs/security/abac.md`, `docs/security/rls.md`, `CHANGELOG.md`
