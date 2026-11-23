-- `crm_leads` - a keyset index for the "deleted leads" screen (Issue #1166,
-- ADR-0153). Forward-only: `sql/342` is applied and is NOT edited.
--
-- ## Why
--
-- `awcms_crm_leads_list_idx` (`sql/342`) is PARTIAL on `deleted_at IS NULL`: it
-- serves the live list and nothing else. The restore screen
-- (`/admin/crm-leads/deleted`) asks for the opposite set, the soft-deleted
-- leads of one tenant, newest first. Without an index of its own that query
-- walks the tenant's whole `created_at` order and filters, so its cost would
-- grow with the number of LIVE leads while the answer (a few deleted rows)
-- stays small.
--
-- The index is partial on `deleted_at IS NOT NULL`, so it holds only the rows
-- the screen can show: its size is the number of soft-deleted leads, and a
-- tenant that deletes nothing pays nothing. No data, role, policy or grant
-- changes here; `awcms_crm_leads` keeps its FORCE RLS as `sql/342` set it.
CREATE INDEX IF NOT EXISTS awcms_crm_leads_deleted_list_idx
  ON awcms_crm_leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;
