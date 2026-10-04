-- Issue #889 / ADR-0127 — the immutable tax snapshot of a finalised document.
--
-- One row per finalised document (`kind = 'sale'`) and one per reversal of it
-- (`kind = 'reversal'`). Lines live INSIDE the row as `lines` jsonb rather than
-- in child tables: a snapshot is read and written whole, is never queried by line
-- except by the reconciliation report (which unnests it), and one table is one
-- append-only guarantee to get right instead of three.
--
-- ## Self-contained on purpose
--
-- The snapshot carries `rule_definition` — a COPY of the rule version it was
-- computed under — as well as the pointer to it. A reversal reads this row alone
-- and never joins to a rule table, so nothing about today's rules can leak into a
-- refund of last year's sale, and the row can be recomputed and compared without
-- trusting that the version row still reads as it did.
--
-- ## Append-only, with one narrow exit
--
-- `awcms_tax_snapshots_immutable` refuses EVERY update. It refuses a delete too,
-- except for a row older than 1826 days (five years and a leap day): the floor
-- below which the `data_lifecycle` descriptor in `tax/module.ts` will not accept
-- a retention policy (`retentionMinDays: 1826`), repeated here so the database
-- stays the last word even if a descriptor is edited. A purge therefore removes
-- history that has aged out of any plausible statutory window and cannot remove
-- anything younger, whoever asks.
--
-- ## A reversal can never refund more than was charged
--
-- The application serialises reversals of one original by locking its row, and
-- computes against what has been reversed so far. `awcms_tax_snapshots_guard`
-- repeats the arithmetic at the database as the backstop: it locks the original
-- too, and refuses a reversal that would take the running total of reversed net
-- or tax below zero. Two concurrent refunds that both read "nothing reversed yet"
-- cannot both commit.
--
-- `original_snapshot_id` is deliberately NOT a foreign key: retention may remove
-- an original that has aged out while a younger reversal of it survives, and a
-- foreign key would turn that purge into a failure. The reversal row is
-- self-contained (above), so it loses nothing it needs. The trigger checks the
-- original exists, in this tenant, at INSERT time, which is when it matters.

CREATE TABLE IF NOT EXISTS awcms_tax_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),

  kind text NOT NULL,
  -- The consumer's own document: an order, an invoice, a POS receipt. Opaque to
  -- this module — no customer data is stored here, only a reference.
  document_type text NOT NULL,
  document_id text NOT NULL,
  original_snapshot_id uuid,

  rule_version_id uuid NOT NULL,
  profile_code text NOT NULL,
  version_no integer NOT NULL,
  tax_date date NOT NULL,
  currency_code char(3) NOT NULL,
  pricing_mode text NOT NULL,
  rounding_mode text NOT NULL,
  rounding_scale smallint NOT NULL,
  rounding_level text NOT NULL,

  -- Copy of the version's `definition`, so the row stands alone.
  rule_definition jsonb NOT NULL,
  -- [{lineNo, lineRef, categoryCode, treatment, quantity, unitPrice, discount,
  --   netAmount, taxAmount, grossAmount, components: [...]}]
  lines jsonb NOT NULL,
  component_totals jsonb NOT NULL,
  treatment_totals jsonb NOT NULL,

  -- Signed: positive for a sale, negative for a reversal. numeric, never float.
  net_total numeric(24, 6) NOT NULL,
  tax_total numeric(24, 6) NOT NULL,
  gross_total numeric(24, 6) NOT NULL,

  -- sha256 of the normalised request. Not a secret and not user data; it lets a
  -- retried finalise tell "same request, replay" from "same document id, different
  -- request, conflict" without storing the request itself.
  input_hash text NOT NULL,
  reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  CONSTRAINT awcms_tax_snapshots_tenant_id_unique UNIQUE (tenant_id, id),
  -- A document is finalised once; a reversal document id is used once.
  CONSTRAINT awcms_tax_snapshots_document_unique
    UNIQUE (tenant_id, kind, document_type, document_id),
  CONSTRAINT awcms_tax_snapshots_rule_version_fk
    FOREIGN KEY (tenant_id, rule_version_id)
    REFERENCES awcms_tax_rule_versions (tenant_id, id),
  CONSTRAINT awcms_tax_snapshots_kind_check
    CHECK (kind IN ('sale', 'reversal')),
  CONSTRAINT awcms_tax_snapshots_original_check
    CHECK (
      (kind = 'sale' AND original_snapshot_id IS NULL)
      OR (kind = 'reversal' AND original_snapshot_id IS NOT NULL)
    ),
  CONSTRAINT awcms_tax_snapshots_sign_check
    CHECK (
      (kind = 'sale'
        AND net_total >= 0 AND tax_total >= 0 AND gross_total >= 0)
      OR (kind = 'reversal'
        AND net_total <= 0 AND tax_total <= 0 AND gross_total <= 0)
    ),
  CONSTRAINT awcms_tax_snapshots_gross_check
    CHECK (gross_total = net_total + tax_total),
  CONSTRAINT awcms_tax_snapshots_shape_check
    CHECK (
      jsonb_typeof(lines) = 'array'
      AND jsonb_typeof(rule_definition) = 'object'
      AND jsonb_typeof(component_totals) = 'array'
      AND jsonb_typeof(treatment_totals) = 'array'
    )
);

-- The admin listing and the keyset cursor.
CREATE INDEX IF NOT EXISTS awcms_tax_snapshots_created_idx
  ON awcms_tax_snapshots (tenant_id, created_at DESC, id DESC);

-- The `(tenant, cursor)` composite the generic retention purge filters by.
CREATE INDEX IF NOT EXISTS awcms_tax_snapshots_retention_idx
  ON awcms_tax_snapshots (tenant_id, created_at);

-- The reconciliation report filters by the document's tax date.
CREATE INDEX IF NOT EXISTS awcms_tax_snapshots_tax_date_idx
  ON awcms_tax_snapshots (tenant_id, tax_date);

-- "What has already been reversed on this original" — the reversal read path.
CREATE INDEX IF NOT EXISTS awcms_tax_snapshots_original_idx
  ON awcms_tax_snapshots (tenant_id, original_snapshot_id)
  WHERE kind = 'reversal';

-- FK column index (`db:fk-index:check`): which snapshots cite a rule version.
CREATE INDEX IF NOT EXISTS awcms_tax_snapshots_rule_version_idx
  ON awcms_tax_snapshots (tenant_id, rule_version_id);

ALTER TABLE awcms_tax_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tax_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tax_snapshots_tenant_isolation
  ON awcms_tax_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The BEGIN/END below are PL/pgSQL block delimiters inside a dollar-quoted body,
-- NOT transaction control (see sql/171).
CREATE OR REPLACE FUNCTION awcms_tax_snapshots_immutable()
RETURNS trigger AS $awcms_tax_snapshots_immutable$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.created_at < now() - interval '1826 days' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'awcms_tax_snapshots row % is append-only (ADR-0127): a correction is a reversal, not an edit',
    OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$awcms_tax_snapshots_immutable$ LANGUAGE plpgsql;

CREATE TRIGGER awcms_tax_snapshots_immutable
  BEFORE UPDATE OR DELETE ON awcms_tax_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION awcms_tax_snapshots_immutable();

CREATE OR REPLACE FUNCTION awcms_tax_snapshots_guard()
RETURNS trigger AS $awcms_tax_snapshots_guard$
DECLARE
  original awcms_tax_snapshots%ROWTYPE;
  reversed_net numeric;
  reversed_tax numeric;
BEGIN
  IF NEW.kind <> 'reversal' THEN
    RETURN NEW;
  END IF;

  -- Locks the original for the rest of this transaction: concurrent reversals of
  -- ONE sale queue here, and the second sums over the first's committed row.
  SELECT * INTO original
  FROM awcms_tax_snapshots
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.original_snapshot_id
    AND kind = 'sale'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'tax reversal %: the original sale snapshot does not exist in this tenant (ADR-0127)',
      NEW.document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF original.document_type <> NEW.document_type
     OR original.rule_version_id <> NEW.rule_version_id THEN
    RAISE EXCEPTION
      'tax reversal %: must carry its original''s document type and rule version (ADR-0127)',
      NEW.document_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(net_total), 0), COALESCE(SUM(tax_total), 0)
    INTO reversed_net, reversed_tax
  FROM awcms_tax_snapshots
  WHERE tenant_id = NEW.tenant_id
    AND kind = 'reversal'
    AND original_snapshot_id = NEW.original_snapshot_id;

  IF original.net_total + reversed_net + NEW.net_total < 0
     OR original.tax_total + reversed_tax + NEW.tax_total < 0 THEN
    RAISE EXCEPTION
      'tax reversal %: would refund more than the original charged (ADR-0127)',
      NEW.document_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$awcms_tax_snapshots_guard$ LANGUAGE plpgsql;

CREATE TRIGGER awcms_tax_snapshots_guard
  BEFORE INSERT ON awcms_tax_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION awcms_tax_snapshots_guard();

-- `awcms_worker` (sql/022) — the `data_lifecycle` retention purge. SELECT to find
-- aged rows, DELETE to remove them (the immutability trigger above still refuses
-- anything younger than 1826 days). No UPDATE: nothing here is ever edited.
GRANT SELECT, DELETE ON awcms_tax_snapshots TO awcms_worker;

COMMENT ON TABLE awcms_tax_snapshots IS
  'ADR-0127 — append-only tax snapshot of a finalised document (kind sale) or of a reversal of one. Self-contained: carries a copy of the rule definition it was computed under.';

COMMENT ON COLUMN awcms_tax_snapshots.original_snapshot_id IS
  'ADR-0127 — NOT a foreign key, deliberately: retention may remove an aged original while a younger reversal survives. Existence is checked by the insert trigger.';

COMMENT ON COLUMN awcms_tax_snapshots.input_hash IS
  'ADR-0127 — sha256 of the normalised request; distinguishes an idempotent replay from a conflicting reuse of a document id without storing the request.';
