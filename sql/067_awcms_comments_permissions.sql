-- ADR-0041 §6 (ported from awcms-micro Issue #271) — permission catalog seed for
-- the `comments` admin/moderation API (moderation queue read, approve/reject/
-- spam, archive, restore, soft-delete, and per-tenant settings read/update).
-- Wires up the constants in `comments/domain/comments-permissions.ts` and this
-- module's own `module.ts` `permissions` declaration.
--
-- Same shape/limitation as every prior permission-seed migration here (see
-- `sql/065`/`sql/067` precedents): this extends the global ABAC catalog only.
-- Existing tenants' `owner` role does NOT retroactively gain these — only tenants
-- created after this migration runs get them via `POST /api/v1/setup/initialize`'s
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`.
-- Backfilling live tenants stays a deployment step, not a migration side effect.
--
-- ## Action-literal mapping (identity-access/domain/access-control.ts)
--
-- Every `action` below is an EXISTING valid `AccessAction` literal — this module
-- adds none. The three concrete moderation OUTCOMES (approve | reject |
-- mark-spam) map to two permissions: `approve` gates publishing a comment, and
-- `reject` gates BOTH rejecting AND marking-as-spam — spam is a rejection subtype
-- with the same "deny publication" blast radius, distinguished by the audited
-- reason code. Inventing a `spam` action instead would widen the union AND plant
-- a latent-authz trap: an action nobody seeds into a role denies even the tenant
-- owner while the code looks correct. `archive`/`restore`/`delete` are their own
-- existing literals. `read` is the non-mutating queue/config view.
-- `settings.update` follows site_search's split — an update changes the public
-- comment surface, so it is audited + idempotency-keyed regardless of
-- classification.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('comments', 'moderation', 'read', 'Read this tenant''s comment moderation queue (pending/reported/rejected/spam), search and filter by status'),
  ('comments', 'moderation', 'approve', 'Approve a pending comment so it is shown publicly — high-risk, idempotency-keyed, audited'),
  ('comments', 'moderation', 'reject', 'Reject a comment or mark it as spam (deny publication) — reason code required, audited'),
  ('comments', 'moderation', 'archive', 'Archive an approved comment (remove from public view, retain for history) — audited'),
  ('comments', 'moderation', 'restore', 'Restore a rejected/spam/archived comment back to pending review — high-risk, audited'),
  ('comments', 'moderation', 'delete', 'Soft-delete a comment (retain the row, remove content from public view) — high-risk, audited'),
  ('comments', 'settings', 'read', 'Read this tenant''s comment configuration (policy mode, moderation, anti-abuse thresholds, blocked terms)'),
  ('comments', 'settings', 'update', 'Update this tenant''s comment configuration — changes the public comment surface (high-risk, audited)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
