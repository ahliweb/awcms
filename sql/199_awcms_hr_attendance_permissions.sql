-- `hr_workforce` attendance permission catalog seed (Issue #947, ADR-0132).
--
-- Verbatim match to `src/modules/hr-workforce/domain/hr-workforce-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_workforce/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
--   * `clock.create` is the EMPLOYEE's power: record your OWN clock-in, clock-out
--     and break events. The handler additionally requires the employment to be
--     linked to the caller's login, so holding it never lets anyone clock for a
--     colleague. It is a permission (not an `ownershipGrant`) because an
--     ownership grant may only widen a READ (ADR-0063); a deployment grants it to
--     the employee role.
--   * `attendance.create` records events FOR ANOTHER employment (a supervisor, a
--     kiosk, an import). It never permits `source = self`. It is a trusted power
--     — an `import` replay may carry a claimed time up to seven days old, flagged
--     `late` — so it is granted to no role by default.
--   * `attendance.read` reads every employee's events. An employee reads their OWN
--     and a supervisor reads their REPORTS' without it, through an
--     `ownershipGrant` (ADR-0063) computed from the persisted login link and the
--     current manager chain; the grant widens only this READ.
--   * `corrections.create` requests a correction; the handler requires the
--     employment to be the caller's own unless the caller also holds
--     `attendance.create`. `corrections.read` reads every correction and its
--     reason; the requester and the workflow's assignees see the reason without it.
--   * `corrections.cancel` withdraws a pending correction — the REQUESTER only
--     (the handler enforces it) — and is HIGH-RISK (the platform classification).
--   * `corrections.approve` APPLIES the workflow's verdict: it reads the
--     `workflow_approval` instance and, when it was approved, appends the
--     superseding event. The decision itself is a workflow decision, made with
--     the workflow module's own permissions; this key cannot approve anything the
--     workflow did not. It is HIGH-RISK, idempotent, audited, and the requester
--     of the correction is refused (self-approval guard, plus the database).
--
-- Nothing here grants compensation, payroll or shift power: `attendance.*` never
-- implies `compensation.*` (those keys do not exist in this phase), and nothing
-- grants a location or evidence power (ADR-0138, Issue #970).
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` (the limitation every permission-seed migration carries — see
-- sql/170). An EXISTING tenant 403s until an operator grants them; run
-- `bun run identity-access:permissions:backfill` (dry-run by default,
-- `--tenant <code>`). Nothing here grants any permission to any role.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_workforce', 'clock', 'create',
   'Record your own clock-in, clock-out and break events; the employment must be linked to your login'),
  ('hr_workforce', 'attendance', 'create',
   'Record an attendance event for another employment (supervisor, kiosk or import source)'),
  ('hr_workforce', 'attendance', 'read',
   'Read attendance events of any employment; an employee reads their own and a supervisor their reports without this'),
  ('hr_workforce', 'corrections', 'create',
   'Request a correction to attendance (add or replace an event), starting an approval workflow instance'),
  ('hr_workforce', 'corrections', 'read',
   'Read attendance corrections and their reasons; the requester and the workflow assignees read theirs without this'),
  ('hr_workforce', 'corrections', 'cancel',
   'Withdraw your own pending attendance correction — high-risk'),
  ('hr_workforce', 'corrections', 'approve',
   'Apply the approval workflow''s verdict on an attendance correction, appending the superseding event — high-risk; the requester is refused')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
