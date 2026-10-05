-- `procurement` permission catalog seed (Issue #888, ADR-0128).
--
-- Verbatim match to `src/modules/procurement/domain/procurement-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/procurement/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
-- Procurement has actions of very different weight; one `manage` would hand the
-- heaviest to whoever needed the lightest:
--
--   * `documents.create` / `.update` write DRAFTS. Nothing a draft says touches
--     stock.
--   * `documents.submit` freezes a draft and starts the optional approval. It is
--     separate from `create` so the person who writes a receipt need not be the
--     person who commits it (maker/checker is a tenant SoD rule over these keys).
--   * `documents.finalise` is the action that POSTS INVENTORY MOVEMENTS.
--     HIGH-RISK, and deliberately not implied by `create`/`submit`.
--   * `documents.cancel` abandons a draft/submitted document. `documents.reverse`
--     compensates a FINALISED one with opposite movements. Both HIGH-RISK and
--     separately grantable: cancelling touches no stock, reversing moves it.
--   * `suppliers.reveal` returns a supplier's tax/business identifier or payment
--     reference IN CLEAR. HIGH-RISK and audited; everything else masks them. It is
--     NOT implied by `suppliers.read`/`update`.
--   * `policy.configure` changes the approval threshold, i.e. which documents
--     need a second pair of eyes before they move stock.
--   * `reports.read` reads supplier spend/volume aggregates (financial data).
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
  ('procurement', 'suppliers', 'read',
   'Read suppliers, their categories/tags and MASKED identifiers'),
  ('procurement', 'suppliers', 'create',
   'Register a supplier'),
  ('procurement', 'suppliers', 'update',
   'Edit a supplier, its labels, identifiers and payment/contact references (values stay masked on read)'),
  ('procurement', 'suppliers', 'delete',
   'Soft-delete a supplier (documents keep referencing it)'),
  ('procurement', 'suppliers', 'restore',
   'Restore a soft-deleted supplier'),
  ('procurement', 'suppliers', 'reveal',
   'Reveal ONE supplier tax/business identifier or payment/contact reference in clear text — audited, high-risk'),
  ('procurement', 'documents', 'read',
   'Read receiving, supplier-return, requisition and transfer documents'),
  ('procurement', 'documents', 'create',
   'Create a draft procurement document'),
  ('procurement', 'documents', 'update',
   'Edit a draft procurement document and its lines'),
  ('procurement', 'documents', 'submit',
   'Submit a draft for finalisation (starts the threshold approval when one applies)'),
  ('procurement', 'documents', 'finalise',
   'Finalise a submitted document — posts inventory movements through the ledger; high-risk'),
  ('procurement', 'documents', 'cancel',
   'Cancel a draft or submitted document (no stock was moved)'),
  ('procurement', 'documents', 'reverse',
   'Reverse a finalised document with compensating inventory movements; high-risk'),
  ('procurement', 'documents', 'reconcile',
   'Run the read-only reconciliation of finalised documents against the inventory ledger'),
  ('procurement', 'policy', 'read',
   'Read the document approval threshold'),
  ('procurement', 'policy', 'configure',
   'Change the document approval threshold — decides which documents need approval before they move stock'),
  ('procurement', 'reports', 'read',
   'Read supplier and receiving aggregates (spend and volume per supplier)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
