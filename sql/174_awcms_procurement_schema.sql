-- `procurement` — suppliers, receiving, supplier returns, requisitions and
-- location transfers on top of the inventory ledger (Issue #888, ADR-0128).
--
-- ## The shape, in one paragraph
--
-- A SUPPLIER is a business role (`awcms_procurement_suppliers`) that may point at
-- a canonical `profile_identity` party (`profile_id`) but never copies its
-- identity. A procurement DOCUMENT (`awcms_procurement_documents`) carries a
-- mode (receive / supplier_return / requisition / transfer), a lifecycle
-- (draft -> submitted -> finalised | cancelled; finalised -> reversed) and its
-- lines. FINALISING a document posts inventory movements THROUGH THE LEDGER'S
-- PORT (`_shared/ports/inventory-ledger-port.ts`) and never writes a balance;
-- each movement is linked back to its document line in
-- `awcms_procurement_document_movements`, which is what lets reconciliation
-- prove "this document's lines == what the ledger recorded under its identity".
--
-- ## The state machine lives in the database, not only in the handler
--
-- A BEFORE UPDATE trigger on the documents table allows exactly the legal
-- transitions and, for each, only the columns that transition may change. So a
-- finalised document is immutable by the database itself: a future code path, a
-- maintenance session or a bug cannot edit its supplier, location or quantities,
-- and cannot "un-finalise" it. Lines are only writable while the parent is a
-- draft. Nothing is ever deleted (REVOKE + trigger): a mistake is corrected by
-- cancelling a draft/submitted document or reversing a finalised one.
--
-- ## Composite (tenant_id, id) foreign keys, including across modules
--
-- Every reference is a composite FK on `(tenant_id, ...)`: the FK is checked
-- with the table owner's rights and sees every row, so it must name the tenant
-- itself or RLS would be the only wall between a document and another tenant's
-- supplier or stock location (sql/020).

-- 0. A composite-FK target on the canonical party table -----------------------
-- `awcms_profiles.id` is already unique; the extra (tenant_id, id) key exists
-- only so a supplier's `profile_id` can be a COMPOSITE foreign key like every
-- other reference here. No data changes and no index is dropped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'awcms_profiles_tenant_id_key'
  ) THEN
    ALTER TABLE awcms_profiles
      ADD CONSTRAINT awcms_profiles_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

-- 1. Tenant-wide policy -------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_procurement_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- NULL = approval is OFF. When set, a document whose total cost is at or above
  -- it cannot be finalised until the `procurement.document_approval` workflow
  -- (workflow_approval) has approved it.
  approval_threshold numeric(30, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_procurement_settings_threshold_check
    CHECK (approval_threshold IS NULL OR approval_threshold >= 0),
  CONSTRAINT awcms_procurement_settings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

ALTER TABLE awcms_procurement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_settings_tenant_isolation
  ON awcms_procurement_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS awcms_procurement_settings_updated_by_idx
  ON awcms_procurement_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

-- 2. Suppliers ----------------------------------------------------------------
-- The supplier BUSINESS ROLE. Identity ownership (ADR-0128 §2): the legal/
-- display identity of a party belongs to `profile_identity`; this row owns only
-- what is true of the party AS a supplier of this tenant (vendor code, status,
-- categories). `profile_id` is optional — a tenant that never adopted the party
-- registry still has suppliers — and is a REFERENCE, so renaming the party does
-- not rewrite this table.
--
-- Soft-deletable (deleted_at) because a supplier is referenced by documents; a
-- row is never removed, and no purge exists (ADR-0128 §7).
CREATE TABLE IF NOT EXISTS awcms_procurement_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  vendor_code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  profile_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_procurement_suppliers_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_procurement_suppliers_code_check
    CHECK (vendor_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_procurement_suppliers_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_procurement_suppliers_status_check
    CHECK (status IN ('active', 'inactive', 'blocked')),
  CONSTRAINT awcms_procurement_suppliers_delete_reason_len
    CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  CONSTRAINT awcms_procurement_suppliers_profile_fkey
    FOREIGN KEY (tenant_id, profile_id)
    REFERENCES awcms_profiles (tenant_id, id),
  CONSTRAINT awcms_procurement_suppliers_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_suppliers_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_suppliers_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_suppliers_restored_by_fkey
    FOREIGN KEY (tenant_id, restored_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Vendor codes are unique per tenant case-insensitively, INCLUDING soft-deleted
-- rows: restoring a supplier must never collide with a code reused meanwhile.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_procurement_suppliers_code_key
  ON awcms_procurement_suppliers (tenant_id, lower(vendor_code));
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_list_idx
  ON awcms_procurement_suppliers (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_profile_idx
  ON awcms_procurement_suppliers (tenant_id, profile_id)
  WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_created_by_idx
  ON awcms_procurement_suppliers (tenant_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_updated_by_idx
  ON awcms_procurement_suppliers (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_deleted_by_idx
  ON awcms_procurement_suppliers (tenant_id, deleted_by)
  WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_suppliers_restored_by_idx
  ON awcms_procurement_suppliers (tenant_id, restored_by)
  WHERE restored_by IS NOT NULL;

ALTER TABLE awcms_procurement_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_suppliers FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_suppliers_tenant_isolation
  ON awcms_procurement_suppliers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_procurement_suppliers FROM awcms_app;

-- 3. Supplier categories and tags ---------------------------------------------
-- A child table rather than `text[]`: Bun.SQL binds a JS array as comma-joined
-- text, and a label set that is filtered on wants an index, not a scan.
CREATE TABLE IF NOT EXISTS awcms_procurement_supplier_labels (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  supplier_id uuid NOT NULL,
  label_kind text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_procurement_supplier_labels_pkey
    PRIMARY KEY (tenant_id, supplier_id, label_kind, label),
  CONSTRAINT awcms_procurement_supplier_labels_supplier_fkey
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES awcms_procurement_suppliers (tenant_id, id),
  CONSTRAINT awcms_procurement_supplier_labels_kind_check
    CHECK (label_kind IN ('category', 'tag')),
  CONSTRAINT awcms_procurement_supplier_labels_label_check
    CHECK (label ~ '^[a-z0-9][a-z0-9_.-]{0,63}$')
);

CREATE INDEX IF NOT EXISTS awcms_procurement_supplier_labels_lookup_idx
  ON awcms_procurement_supplier_labels (tenant_id, label_kind, label, supplier_id);

ALTER TABLE awcms_procurement_supplier_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_supplier_labels FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_supplier_labels_tenant_isolation
  ON awcms_procurement_supplier_labels
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 4. Supplier identifiers and payment/contact references (SENSITIVE) ----------
-- Tax and business registration numbers, and the payment/contact references of
-- a supplier. The same pipeline as `awcms_profile_identifiers` (doc 04):
-- a normalized value, a hash for dedup/lookup, and a MASKED value for display.
-- EVERY response and log carries `masked_value` only; the normalized value
-- leaves the database through exactly one endpoint, the audited, separately
-- permissioned reveal (`procurement.suppliers.reveal`).
--
-- `classification` states the sensitivity on the row rather than in a document:
-- tax/business identifiers are `sensitive`, a payment/contact reference or
-- anything else is `confidential`. Both are masked; the column exists so a
-- later, finer reveal policy has something to key on.
CREATE TABLE IF NOT EXISTS awcms_procurement_supplier_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  supplier_id uuid NOT NULL,
  identifier_type text NOT NULL,
  label text,
  normalized_value text NOT NULL,
  value_hash text NOT NULL,
  masked_value text NOT NULL,
  classification text NOT NULL DEFAULT 'sensitive',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_procurement_supplier_identifiers_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_procurement_supplier_identifiers_dedup_key
    UNIQUE (tenant_id, supplier_id, identifier_type, value_hash),
  CONSTRAINT awcms_procurement_supplier_identifiers_type_check
    CHECK (identifier_type IN
      ('tax_id', 'business_id', 'payment_ref', 'contact_ref', 'other')),
  CONSTRAINT awcms_procurement_supplier_identifiers_class_check
    CHECK (classification IN ('sensitive', 'confidential')),
  CONSTRAINT awcms_procurement_supplier_identifiers_sensitive_check
    CHECK (identifier_type NOT IN ('tax_id', 'business_id')
           OR classification = 'sensitive'),
  CONSTRAINT awcms_procurement_supplier_identifiers_label_len
    CHECK (label IS NULL OR char_length(label) <= 100),
  CONSTRAINT awcms_procurement_supplier_identifiers_value_len
    CHECK (char_length(normalized_value) BETWEEN 1 AND 200),
  CONSTRAINT awcms_procurement_supplier_identifiers_supplier_fkey
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES awcms_procurement_suppliers (tenant_id, id),
  CONSTRAINT awcms_procurement_supplier_identifiers_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_procurement_supplier_identifiers_supplier_idx
  ON awcms_procurement_supplier_identifiers (tenant_id, supplier_id, created_at, id);
CREATE INDEX IF NOT EXISTS awcms_procurement_supplier_identifiers_created_by_idx
  ON awcms_procurement_supplier_identifiers (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE awcms_procurement_supplier_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_supplier_identifiers FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_supplier_identifiers_tenant_isolation
  ON awcms_procurement_supplier_identifiers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 5. Documents ----------------------------------------------------------------
-- One table for the four modes. `location_id` is where stock ARRIVES for
-- receive/requisition/transfer and where it LEAVES for a supplier_return;
-- `source_location_id` is the sending location of a requisition/transfer.
CREATE TABLE IF NOT EXISTS awcms_procurement_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  document_no text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  supplier_id uuid,
  -- Snapshots: what the supplier was CALLED when this document was written.
  -- Renaming or deactivating a supplier must not rewrite history.
  supplier_code_snapshot text,
  supplier_name_snapshot text,
  location_id uuid NOT NULL,
  source_location_id uuid,
  external_reference text,
  document_date date NOT NULL DEFAULT current_date,
  notes text,
  currency_code text NOT NULL DEFAULT 'IDR',
  -- Set at submit from the lines (SUM(quantity * unit_cost)), exact numeric.
  total_cost numeric(30, 6),
  line_count integer NOT NULL DEFAULT 0,
  -- Optional threshold approval (workflow_approval). `not_required` is a
  -- DECISION recorded at submit, so a threshold raised later cannot retroactively
  -- demand approval of a document already submitted without it.
  approval_status text NOT NULL DEFAULT 'not_required',
  approval_instance_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  submitted_at timestamptz,
  submitted_by uuid,
  finalised_at timestamptz,
  finalised_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_reason text,
  CONSTRAINT awcms_procurement_documents_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_no_key UNIQUE (tenant_id, document_no),
  CONSTRAINT awcms_procurement_documents_mode_check
    CHECK (mode IN ('receive', 'supplier_return', 'requisition', 'transfer')),
  CONSTRAINT awcms_procurement_documents_status_check
    CHECK (status IN ('draft', 'submitted', 'finalised', 'cancelled', 'reversed')),
  -- The mode decides the shape: supplier modes name a supplier and one
  -- location; location modes name two DIFFERENT locations and no supplier.
  CONSTRAINT awcms_procurement_documents_mode_shape_check
    CHECK (
      (mode IN ('receive', 'supplier_return')
        AND supplier_id IS NOT NULL AND source_location_id IS NULL)
      OR (mode IN ('requisition', 'transfer')
        AND supplier_id IS NULL AND source_location_id IS NOT NULL
        AND source_location_id <> location_id)
    ),
  CONSTRAINT awcms_procurement_documents_no_len
    CHECK (char_length(document_no) BETWEEN 1 AND 64),
  CONSTRAINT awcms_procurement_documents_extref_len
    CHECK (external_reference IS NULL
           OR char_length(external_reference) BETWEEN 1 AND 200),
  CONSTRAINT awcms_procurement_documents_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT awcms_procurement_documents_currency_check
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT awcms_procurement_documents_total_check
    CHECK (total_cost IS NULL OR total_cost >= 0),
  CONSTRAINT awcms_procurement_documents_line_count_check
    CHECK (line_count >= 0),
  CONSTRAINT awcms_procurement_documents_approval_check
    CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected')),
  CONSTRAINT awcms_procurement_documents_approval_instance_check
    CHECK (approval_status = 'not_required' OR approval_instance_id IS NOT NULL),
  -- An approved-or-not-required document is the ONLY kind that can be finalised
  -- (security audit M4): `pending` and `rejected` must never reach `finalised`,
  -- whatever the application did, and `reversed` follows a finalised one so it
  -- is held to the same rule.
  CONSTRAINT awcms_procurement_documents_finalise_approval_check
    CHECK (status NOT IN ('finalised', 'reversed')
           OR approval_status IN ('not_required', 'approved')),
  -- Who finalised / reversed, and why, are NOT NULL facts alongside their
  -- timestamps (audit L7); the reverse reason is mandatory at the API.
  CONSTRAINT awcms_procurement_documents_actor_stamps_check
    CHECK ((finalised_at IS NULL OR finalised_by IS NOT NULL)
           AND (reversed_at IS NULL
                OR (reversed_by IS NOT NULL AND reverse_reason IS NOT NULL))),
  CONSTRAINT awcms_procurement_documents_reason_len
    CHECK ((cancel_reason IS NULL OR char_length(cancel_reason) <= 500)
           AND (reverse_reason IS NULL OR char_length(reverse_reason) <= 500)),
  -- A status never exists without its stamp: the audit trail of "who finalised
  -- this" is a NOT NULL fact, not an optional column.
  CONSTRAINT awcms_procurement_documents_stamps_check
    CHECK (
      (status = 'draft' AND submitted_at IS NULL AND finalised_at IS NULL
        AND cancelled_at IS NULL AND reversed_at IS NULL)
      OR (status = 'submitted' AND submitted_at IS NOT NULL
        AND finalised_at IS NULL AND cancelled_at IS NULL AND reversed_at IS NULL)
      OR (status = 'finalised' AND submitted_at IS NOT NULL
        AND finalised_at IS NOT NULL AND cancelled_at IS NULL
        AND reversed_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL
        AND finalised_at IS NULL AND reversed_at IS NULL)
      OR (status = 'reversed' AND finalised_at IS NOT NULL
        AND reversed_at IS NOT NULL AND cancelled_at IS NULL)
    ),
  CONSTRAINT awcms_procurement_documents_supplier_fkey
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES awcms_procurement_suppliers (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_location_fkey
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES awcms_inventory_locations (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_source_location_fkey
    FOREIGN KEY (tenant_id, source_location_id)
    REFERENCES awcms_inventory_locations (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_submitted_by_fkey
    FOREIGN KEY (tenant_id, submitted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_finalised_by_fkey
    FOREIGN KEY (tenant_id, finalised_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_cancelled_by_fkey
    FOREIGN KEY (tenant_id, cancelled_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_procurement_documents_reversed_by_fkey
    FOREIGN KEY (tenant_id, reversed_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- A supplier's delivery note / PO number can be received ONCE: a second live
-- receipt (or return) naming the same external reference for the same supplier
-- is a double-receive in waiting, so the database refuses it. A cancelled or
-- reversed document (net-zero stock, a compensating movement exists) frees the
-- reference so the same delivery can be received again (audit L7).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_procurement_documents_extref_key
  ON awcms_procurement_documents (tenant_id, mode, supplier_id, lower(external_reference))
  WHERE external_reference IS NOT NULL
    AND supplier_id IS NOT NULL
    AND status NOT IN ('cancelled', 'reversed');

CREATE INDEX IF NOT EXISTS awcms_procurement_documents_list_idx
  ON awcms_procurement_documents (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_status_idx
  ON awcms_procurement_documents (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_supplier_idx
  ON awcms_procurement_documents (tenant_id, supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_location_idx
  ON awcms_procurement_documents (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_source_location_idx
  ON awcms_procurement_documents (tenant_id, source_location_id)
  WHERE source_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_created_by_idx
  ON awcms_procurement_documents (tenant_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_updated_by_idx
  ON awcms_procurement_documents (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_submitted_by_idx
  ON awcms_procurement_documents (tenant_id, submitted_by)
  WHERE submitted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_finalised_by_idx
  ON awcms_procurement_documents (tenant_id, finalised_by)
  WHERE finalised_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_cancelled_by_idx
  ON awcms_procurement_documents (tenant_id, cancelled_by)
  WHERE cancelled_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_documents_reversed_by_idx
  ON awcms_procurement_documents (tenant_id, reversed_by)
  WHERE reversed_by IS NOT NULL;

ALTER TABLE awcms_procurement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_documents_tenant_isolation
  ON awcms_procurement_documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Document lines -----------------------------------------------------------
-- Snapshots of what the line meant WHEN WRITTEN: the opaque ledger reference
-- (`item_type`/`item_ref`), the SKU and name as the catalogue then called them,
-- the unit of measure, and the cost — exact `numeric`, never a float. The
-- catalogue belongs to the consumer module (ADR-0126 §3), so a renamed product
-- cannot rewrite what was received.
CREATE TABLE IF NOT EXISTS awcms_procurement_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  document_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_type text NOT NULL,
  item_ref text NOT NULL,
  sku text NOT NULL,
  item_name text NOT NULL,
  unit_code text NOT NULL,
  quantity numeric(20, 6) NOT NULL,
  unit_cost numeric(20, 6),
  -- Computed by the database so a line total can never disagree with its inputs.
  line_total numeric(40, 6) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_procurement_document_lines_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_procurement_document_lines_no_key
    UNIQUE (tenant_id, document_id, line_no),
  CONSTRAINT awcms_procurement_document_lines_no_check
    CHECK (line_no BETWEEN 1 AND 500),
  CONSTRAINT awcms_procurement_document_lines_qty_check
    CHECK (quantity > 0),
  CONSTRAINT awcms_procurement_document_lines_cost_check
    CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT awcms_procurement_document_lines_item_type_check
    CHECK (item_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_procurement_document_lines_item_ref_check
    CHECK (char_length(item_ref) BETWEEN 1 AND 200),
  CONSTRAINT awcms_procurement_document_lines_unit_check
    CHECK (unit_code ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  CONSTRAINT awcms_procurement_document_lines_sku_len
    CHECK (char_length(sku) BETWEEN 1 AND 120),
  CONSTRAINT awcms_procurement_document_lines_name_len
    CHECK (char_length(item_name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_procurement_document_lines_document_fkey
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES awcms_procurement_documents (tenant_id, id)
);

-- The composite FK's leading pair is also the unique key above.
ALTER TABLE awcms_procurement_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_document_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_document_lines_tenant_isolation
  ON awcms_procurement_document_lines
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 7. Document <-> ledger movement links (append-only) -------------------------
-- Which ledger movements a finalised (or reversed) document produced, per line.
-- The ledger identifies a movement by its SOURCE identity
-- (`source_type`, `source_id` = document id, `source_line` = line_no); this table
-- adds the direct, indexed reference reconciliation and the document detail
-- endpoint need, and a composite FK that makes "a link to another tenant's
-- movement" unrepresentable.
CREATE TABLE IF NOT EXISTS awcms_procurement_document_movements (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  document_id uuid NOT NULL,
  line_no integer NOT NULL,
  -- `post` for the finalisation, `reversal` for the compensating movements.
  operation text NOT NULL,
  movement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_procurement_document_movements_pkey
    PRIMARY KEY (tenant_id, movement_id),
  CONSTRAINT awcms_procurement_document_movements_op_check
    CHECK (operation IN ('post', 'reversal')),
  CONSTRAINT awcms_procurement_document_movements_line_fkey
    FOREIGN KEY (tenant_id, document_id, line_no)
    REFERENCES awcms_procurement_document_lines (tenant_id, document_id, line_no),
  CONSTRAINT awcms_procurement_document_movements_movement_fkey
    FOREIGN KEY (tenant_id, movement_id)
    REFERENCES awcms_inventory_movements (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_procurement_document_movements_doc_idx
  ON awcms_procurement_document_movements
  (tenant_id, document_id, line_no, operation);

ALTER TABLE awcms_procurement_document_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_document_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_document_movements_tenant_isolation
  ON awcms_procurement_document_movements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 8. Document events (append-only; the reporting projections' source) ---------
CREATE TABLE IF NOT EXISTS awcms_procurement_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  document_id uuid NOT NULL,
  mode text NOT NULL,
  event_kind text NOT NULL,
  supplier_id uuid,
  total_cost numeric(30, 6),
  line_count integer NOT NULL DEFAULT 0,
  -- GENERATED so a projection can count one (kind, mode) pair with the engine's
  -- single `matchColumn`, and so the two columns cannot disagree with their
  -- inputs. `supplier_event_kind` is NULL for a location-only document.
  kind_mode text GENERATED ALWAYS AS (event_kind || ':' || mode) STORED,
  supplier_event_kind text GENERATED ALWAYS AS (
    CASE WHEN supplier_id IS NOT NULL THEN event_kind END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_tenant_user_id uuid,
  CONSTRAINT awcms_procurement_document_events_kind_check
    CHECK (event_kind IN ('submitted', 'finalised', 'cancelled', 'reversed')),
  CONSTRAINT awcms_procurement_document_events_mode_check
    CHECK (mode IN ('receive', 'supplier_return', 'requisition', 'transfer')),
  CONSTRAINT awcms_procurement_document_events_document_fkey
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES awcms_procurement_documents (tenant_id, id),
  CONSTRAINT awcms_procurement_document_events_supplier_fkey
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES awcms_procurement_suppliers (tenant_id, id),
  CONSTRAINT awcms_procurement_document_events_actor_fkey
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- A document reaches each of `finalised`/`cancelled`/`reversed` at most once,
-- so a double-counted projection is structurally impossible.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_procurement_document_events_once_key
  ON awcms_procurement_document_events (tenant_id, document_id, event_kind);
-- The projection's cursor scan.
CREATE INDEX IF NOT EXISTS awcms_procurement_document_events_cursor_idx
  ON awcms_procurement_document_events (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS awcms_procurement_document_events_supplier_idx
  ON awcms_procurement_document_events (tenant_id, supplier_id)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_procurement_document_events_actor_idx
  ON awcms_procurement_document_events (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_procurement_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_procurement_document_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_procurement_document_events_tenant_isolation
  ON awcms_procurement_document_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 9. Immutability -------------------------------------------------------------
-- Two independent layers, as in sql/169: a row trigger (stops a role that holds
-- the privilege) AND a REVOKE (so the runtime role cannot even attempt it).
CREATE OR REPLACE FUNCTION awcms_procurement_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'awcms_procurement: % is append-only; % is not allowed',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER awcms_procurement_document_movements_append_only
  BEFORE UPDATE OR DELETE ON awcms_procurement_document_movements
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_reject_mutation();

CREATE TRIGGER awcms_procurement_document_events_append_only
  BEFORE UPDATE OR DELETE ON awcms_procurement_document_events
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_reject_mutation();

-- Documents are never deleted: cancel a draft/submitted one, reverse a
-- finalised one.
CREATE TRIGGER awcms_procurement_documents_no_delete
  BEFORE DELETE ON awcms_procurement_documents
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_procurement_document_movements FROM awcms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_procurement_document_events FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_procurement_documents FROM awcms_app;

-- 10. The document state machine ----------------------------------------------
-- BEFORE INSERT: a document is born a draft, with no stamps (the stamps CHECK
-- would refuse most of it anyway, but "born finalised" is the case worth naming).
CREATE OR REPLACE FUNCTION awcms_procurement_guard_document_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION
      'awcms_procurement: a document is created as draft, not %', NEW.status
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_procurement_documents_insert_guard
  BEFORE INSERT ON awcms_procurement_documents
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_guard_document_insert();

-- BEFORE UPDATE: exactly the legal transitions, and for each only the columns
-- it may change. Everything else must be byte-identical (compared as jsonb, so
-- a column added later is covered by default rather than silently exempt).
--
--   draft      -> draft       any editable column (not identity/no/mode)
--   draft      -> submitted   totals, approval, submit stamp
--   draft      -> cancelled   cancel stamp
--   submitted  -> submitted   approval_status only, pending -> approved|rejected
--   submitted  -> finalised   finalise stamp (approval must be settled)
--   submitted  -> cancelled   cancel stamp
--   finalised  -> reversed    reverse stamp
--
-- cancelled and reversed are terminal; finalised is immutable except to reverse.
CREATE OR REPLACE FUNCTION awcms_procurement_guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed text[];
  transition text := OLD.status || '->' || NEW.status;
BEGIN
  allowed := CASE transition
    WHEN 'draft->draft' THEN ARRAY[
      'supplier_id', 'supplier_code_snapshot', 'supplier_name_snapshot',
      'location_id', 'source_location_id', 'external_reference',
      'document_date', 'notes', 'currency_code', 'total_cost', 'line_count',
      'updated_at', 'updated_by']
    WHEN 'draft->submitted' THEN ARRAY[
      'status', 'total_cost', 'line_count', 'approval_status',
      'approval_instance_id', 'submitted_at', 'submitted_by',
      'updated_at', 'updated_by']
    WHEN 'draft->cancelled' THEN ARRAY[
      'status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
      'updated_at', 'updated_by']
    WHEN 'submitted->submitted' THEN ARRAY[
      'approval_status', 'updated_at', 'updated_by']
    WHEN 'submitted->finalised' THEN ARRAY[
      'status', 'finalised_at', 'finalised_by', 'updated_at', 'updated_by']
    WHEN 'submitted->cancelled' THEN ARRAY[
      'status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
      'updated_at', 'updated_by']
    WHEN 'finalised->reversed' THEN ARRAY[
      'status', 'reversed_at', 'reversed_by', 'reverse_reason',
      'updated_at', 'updated_by']
    ELSE NULL
  END;

  IF allowed IS NULL THEN
    RAISE EXCEPTION
      'awcms_procurement: illegal document transition % for document %',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- The approval decision is a one-way door (audit M4): a submitted document's
  -- approval may only move pending -> approved|rejected, and the workflow
  -- instance it points at is fixed at submit — never re-pointed, never cleared.
  -- (`approval_instance_id` is in no allowed set after submit, so the
  -- byte-identical check below already holds it; `finalised` additionally
  -- needs the CHECK above.)
  IF transition = 'submitted->submitted'
     AND NOT (OLD.approval_status = 'pending'
              AND NEW.approval_status IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION
      'awcms_procurement: approval may only move pending -> approved|rejected (document %)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'awcms_procurement: transition % may not change any column outside its allowed set (document %)',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_procurement_documents_update_guard
  BEFORE UPDATE ON awcms_procurement_documents
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_guard_document_update();

-- 11. Lines are writable only while the parent is a draft ---------------------
-- FOR SHARE: a concurrent submit holds FOR UPDATE on the document, so a line
-- insert racing it WAITS for the verdict instead of reading a stale `draft`.
CREATE OR REPLACE FUNCTION awcms_procurement_guard_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_id uuid;
  parent_ids uuid[];
BEGIN
  -- EVERY document this write touches must still be a draft: the NEW parent for
  -- an INSERT/UPDATE, the OLD parent for a DELETE, and BOTH for an UPDATE that
  -- re-points a line (otherwise a line could be MOVED OUT of a finalised document
  -- into a draft — the finalised document's lines would change under it).
  IF TG_OP = 'DELETE' THEN
    parent_ids := ARRAY[OLD.document_id];
  ELSIF TG_OP = 'UPDATE' AND OLD.document_id IS DISTINCT FROM NEW.document_id THEN
    parent_ids := ARRAY[OLD.document_id, NEW.document_id];
  ELSE
    parent_ids := ARRAY[NEW.document_id];
  END IF;

  FOREACH parent_id IN ARRAY parent_ids LOOP
    SELECT status INTO parent_status
    FROM awcms_procurement_documents
    WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
      AND id = parent_id
    FOR SHARE;

    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'awcms_procurement: lines of document % are immutable once it leaves draft (status %)',
        parent_id, parent_status
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_procurement_document_lines_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON awcms_procurement_document_lines
  FOR EACH ROW EXECUTE FUNCTION awcms_procurement_guard_line_write();

-- 12. Worker access for the reporting projections -------------------------------
-- `procurement.receiving` and `procurement.suppliers` read this table from the
-- reporting engine's incremental worker, which runs as `awcms_worker` when
-- WORKER_DATABASE_URL is set. SELECT only (the engine writes exclusively to its
-- own awcms_reporting_projection_* tables).
GRANT SELECT ON awcms_procurement_document_events TO awcms_worker;

COMMENT ON TABLE awcms_procurement_documents IS
  'Issue #888 / ADR-0128 — receive/supplier_return/requisition/transfer documents. State machine enforced by trigger; finalised documents are immutable except to reverse; never deleted.';
COMMENT ON TABLE awcms_procurement_document_lines IS
  'Issue #888 / ADR-0128 — line snapshots (sku, name, unit, exact cost). Writable only while the parent is a draft.';
COMMENT ON TABLE awcms_procurement_document_movements IS
  'Issue #888 / ADR-0128 — append-only links from a document line to the inventory ledger movements finalising/reversing it produced; the join reconciliation uses.';
COMMENT ON TABLE awcms_procurement_document_events IS
  'Issue #888 / ADR-0128 — append-only lifecycle events (submitted/finalised/cancelled/reversed); the source stream of the procurement reporting projections.';
COMMENT ON TABLE awcms_procurement_supplier_identifiers IS
  'Issue #888 / ADR-0128 — SENSITIVE supplier tax/business identifiers and payment/contact references. Only masked_value leaves the database, except through the audited reveal endpoint.';
