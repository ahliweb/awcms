-- `inventory` permission catalog seed (Issue #887, ADR-0126).
--
-- Verbatim match to `src/modules/inventory/domain/inventory-permissions.ts` and
-- to `module.ts`'s `permissions` array (`GET /api/v1/modules/inventory/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why this many permissions, and why they are split the way they are
--
-- A stock ledger has powers of very different weight, and one `manage` would
-- hand the heaviest to whoever needed the lightest:
--
--   * `movements.create` posts the everyday movements — receive, sale, returns.
--     A POS service account needs exactly this. They are CALLER-ATTESTED: the
--     ledger trusts the source identity it is given (it can prove a document was
--     not posted twice, never that it exists), so verifying the source is the
--     consumer's duty and this permission is only as safe as the caller.
--   * `movements.adjust` posts an ADJUSTMENT, an OPENING balance, or reverses an
--     adjustment. Those are the only ways to change stock without a business
--     document behind them (a count correction, shrinkage, a starting figure), so
--     the permission is separately grantable and HIGH-RISK. An opening is NOT
--     postable with `create`: a service account that can ring up sales must not
--     be able to conjure inventory.
--   * `movements.transfer` moves stock between two locations. HIGH-RISK on the
--     same reasoning as a warehouse transfer in AGENTS.md: it changes two
--     balances at once.
--   * `policy.configure` changes whether stock may go negative and the low-stock
--     thresholds — a control that silently widens what `movements.create` can do.
--   * `balances.reconcile` is a read-only proof; `balances.rebuild` WRITES
--     balances from the ledger and is HIGH-RISK.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` — the same limitation every permission-seed migration here
-- carries (see sql/135, sql/152). An EXISTING tenant 403s until an operator
-- grants them; `bun run identity-access:permissions:backfill` (dry-run by
-- default, `--tenant <code>`) is the supported, auditable path. Nothing here
-- grants any permission to any role: default-deny is the posture.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('inventory', 'locations', 'read',
   'Read this tenant''s stock locations'),
  ('inventory', 'locations', 'create',
   'Register a stock location'),
  ('inventory', 'locations', 'update',
   'Rename a stock location, attach it to a business location, or deactivate/reactivate it'),
  ('inventory', 'policy', 'read',
   'Read the tenant default and per-location negative-stock policy'),
  ('inventory', 'policy', 'configure',
   'Change the negative-stock policy and low-stock thresholds — decides whether stock may silently go below zero'),
  ('inventory', 'balances', 'read',
   'Read stock balances and the low-stock list'),
  ('inventory', 'balances', 'reconcile',
   'Run the read-only reconciliation that proves each balance equals the sum of its movements'),
  ('inventory', 'balances', 'rebuild',
   'Repair drifted balances from the movement ledger — writes balances, audited at critical severity'),
  ('inventory', 'movements', 'read',
   'Read the stock movement ledger'),
  ('inventory', 'movements', 'create',
   'Post caller-attested stock movements: receive, sale, sale return, supplier return — the ledger trusts the source identity supplied, so verifying the document is the consumer duty'),
  ('inventory', 'movements', 'adjust',
   'Post a stock adjustment or an opening balance, or reverse an adjustment — the only changes to stock without a business document behind them'),
  ('inventory', 'movements', 'transfer',
   'Transfer stock between two locations as a balanced out/in pair')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
