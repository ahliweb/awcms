-- `inventory` — a generic, auditable multi-location STOCK LEDGER (Issue #887,
-- ADR-0126).
--
-- Today a consumer module (commerce, POS, storefront) keeps its own single
-- stock counter on a product or variant row. A counter says how many there are
-- NOW; it cannot say where, why, who changed it, or whether the number is still
-- the sum of what happened. This module is the inventory AUTHORITY instead: an
-- append-only movement ledger, a balance that is always the sum of it, and a
-- small policy surface (negative stock, low-stock threshold).
--
-- ## The shape, in one paragraph
--
-- `awcms_inventory_movements` is the truth. It is append-only — enforced by a
-- trigger AND by privileges, not by application discipline — and a mistake is
-- corrected by a COMPENSATING movement, never by an edit. `awcms_inventory_
-- balances` is a derived read model kept in step by the posting code under a row
-- lock; reconciliation (`GET .../balances/reconciliation`) proves
-- `balance == SUM(movements)` and `.../balances/rebuild` repairs a drifted row
-- FROM the ledger. A client can never assert a balance: there is no endpoint
-- that accepts one, and `opening` is a movement like any other.
--
-- ## Item references are OPAQUE
--
-- `(item_type, item_ref)` is supplied by the consumer and is deliberately NOT a
-- foreign key to any catalogue. The catalogue (a product table, a variant, a
-- bundle component) belongs to the consumer module, and a hard FK would make
-- this module depend on every consumer's schema — the exact coupling ADR-0011's
-- capability-port rule exists to prevent. The cost is stated: the ledger cannot
-- tell that an `item_ref` names a deleted product. The consumer adapter contract
-- (docs/awcms/inventory-ledger.md) puts that duty on the consumer.
--
-- ## Quantity semantics and the unit-of-measure decision
--
-- `numeric(20,6)`, never `float`. A quantity is expressed in the item's single
-- STOCK UNIT, chosen by the consumer. The ledger does NOT convert units: one
-- `(item_type, item_ref)` has exactly one unit at a location, recorded on the
-- balance when its first movement lands, and a later movement carrying a
-- different `unit_code` is REFUSED (409) rather than summed. Converting "box of
-- 12" to "each" is a catalogue concern; summing the two silently is how a ledger
-- ends up true to the digit and wrong in meaning.
--
-- ## Composite (tenant_id, id) foreign keys
--
-- Every reference inside this module is a composite FK on `(tenant_id, …)`, so
-- RLS is not the only thing standing between a movement and another tenant's
-- location: the row cannot be written at all. (An FK is checked with the
-- table owner's rights and sees every row, which is precisely why it must name
-- the tenant itself — see sql/020.)

-- 1. Tenant-wide policy ------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_inventory_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- `forbid`: a movement that would take a balance below zero is refused.
  -- `allow`: it is accepted and the balance goes negative (backorders, or a
  -- shop that sells before it records the receipt). Resolved as
  -- location override -> this default -> `forbid`, so a tenant that never
  -- configured anything gets the safe answer.
  default_negative_stock_policy text NOT NULL DEFAULT 'forbid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_inventory_settings_policy_check
    CHECK (default_negative_stock_policy IN ('forbid', 'allow')),
  CONSTRAINT awcms_inventory_settings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

ALTER TABLE awcms_inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inventory_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inventory_settings_tenant_isolation
  ON awcms_inventory_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- FK index (db:fk-index:check): the composite FK's leading column is the PK, but
-- the (tenant_id, updated_by) pair is not covered by it.
CREATE INDEX IF NOT EXISTS awcms_inventory_settings_updated_by_idx
  ON awcms_inventory_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

-- 2. Stock locations ---------------------------------------------------------
-- A place stock is held: a shelf, a stockroom, a branch's sales floor. Scoped to
-- the tenant and, optionally, to a business location (`awcms_offices`).
--
-- Deliberately NOT soft-deletable. A location that has movements can never go
-- away without orphaning ledger rows, so the lifecycle is `active` -> `inactive`
-- (no new postings), which is reversible and loses nothing. ADR-0126 §6.
CREATE TABLE IF NOT EXISTS awcms_inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  -- The business location this stock location belongs to. Nullable: a tenant
  -- with one stockroom and no office registry is a valid tenant.
  office_id uuid,
  status text NOT NULL DEFAULT 'active',
  -- NULL inherits `awcms_inventory_settings.default_negative_stock_policy`.
  negative_stock_policy text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_inventory_locations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inventory_locations_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT awcms_inventory_locations_code_check
    CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_inventory_locations_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_inventory_locations_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT awcms_inventory_locations_policy_check
    CHECK (negative_stock_policy IS NULL
           OR negative_stock_policy IN ('forbid', 'allow')),
  CONSTRAINT awcms_inventory_locations_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_inventory_locations_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inventory_locations_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_inventory_locations_office_idx
  ON awcms_inventory_locations (tenant_id, office_id)
  WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_inventory_locations_created_by_idx
  ON awcms_inventory_locations (tenant_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_inventory_locations_updated_by_idx
  ON awcms_inventory_locations (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;
-- Listing order.
CREATE INDEX IF NOT EXISTS awcms_inventory_locations_list_idx
  ON awcms_inventory_locations (tenant_id, code);

ALTER TABLE awcms_inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inventory_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inventory_locations_tenant_isolation
  ON awcms_inventory_locations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. Balances (derived) ------------------------------------------------------
-- One row per (location, item). A READ MODEL of the movement ledger: it is
-- written only by the posting code, only in the same transaction as the
-- movement that changes it, and only under the row lock that makes "the last
-- unit" safe. `on_hand == SUM(movements.quantity_delta)` is the invariant, and
-- reconciliation exists to prove it rather than to hope for it.
CREATE TABLE IF NOT EXISTS awcms_inventory_balances (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  location_id uuid NOT NULL,
  item_type text NOT NULL,
  item_ref text NOT NULL,
  unit_code text NOT NULL,
  on_hand numeric(20, 6) NOT NULL DEFAULT 0,
  -- NULL = no threshold. A balance at or below it is "low".
  low_stock_threshold numeric(20, 6),
  -- GENERATED, so "low" cannot disagree with its own two inputs and no code path
  -- has to remember to refresh it.
  is_low boolean GENERATED ALWAYS AS (
    low_stock_threshold IS NOT NULL AND on_hand <= low_stock_threshold
  ) STORED,
  movement_count bigint NOT NULL DEFAULT 0,
  last_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inventory_balances_pkey
    PRIMARY KEY (tenant_id, location_id, item_type, item_ref),
  CONSTRAINT awcms_inventory_balances_location_fkey
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES awcms_inventory_locations (tenant_id, id),
  CONSTRAINT awcms_inventory_balances_item_type_check
    CHECK (item_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_inventory_balances_item_ref_check
    CHECK (char_length(item_ref) BETWEEN 1 AND 200),
  CONSTRAINT awcms_inventory_balances_unit_check
    CHECK (unit_code ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  CONSTRAINT awcms_inventory_balances_threshold_check
    CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0)
);

-- "Show me what is low": partial, so the common case (nothing is low) costs an
-- empty index, and the keyset order matches the list endpoint.
CREATE INDEX IF NOT EXISTS awcms_inventory_balances_low_idx
  ON awcms_inventory_balances (tenant_id, location_id, item_type, item_ref)
  WHERE is_low;
-- "Where is this item": lookups by item across locations.
CREATE INDEX IF NOT EXISTS awcms_inventory_balances_item_idx
  ON awcms_inventory_balances (tenant_id, item_type, item_ref);

ALTER TABLE awcms_inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inventory_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inventory_balances_tenant_isolation
  ON awcms_inventory_balances
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 4. Movements (the ledger) --------------------------------------------------
-- Append-only. Finalised the moment they are inserted; there is no draft state
-- in this issue (`reservation`/`hold` are a documented later extension and would
-- be a separate table, not a status on this one — a hold that can be released is
-- exactly the mutability this table must not have).
CREATE TABLE IF NOT EXISTS awcms_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  location_id uuid NOT NULL,
  item_type text NOT NULL,
  item_ref text NOT NULL,
  unit_code text NOT NULL,
  movement_type text NOT NULL,
  -- SIGNED. The request carries a positive quantity and the type decides the
  -- sign (`sale` is negative); only `adjustment` carries its own sign.
  quantity_delta numeric(20, 6) NOT NULL,
  -- The running balance immediately after this movement, taken under the row
  -- lock. Stored so a reader can audit the chain without recomputing it, and so
  -- reconciliation has a second witness besides the SUM.
  balance_after numeric(20, 6) NOT NULL,
  -- Idempotent source identity. `source_line` is '' (not NULL) when the source
  -- has no lines, because a NULL would make the unique key below treat two
  -- identical postings as distinct — NULLs never collide.
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_line text NOT NULL DEFAULT '',
  -- Server-derived from `movement_type` (`reversal` for a reversal). Never
  -- caller-chosen, so a caller cannot dodge replay detection by renaming it.
  operation text NOT NULL,
  -- Both legs of a transfer share this id; NULL for every other type.
  transfer_id uuid,
  -- The adjustment this movement compensates. At most one reversal per target.
  reverses_movement_id uuid,
  reason_code text,
  note text,
  -- SHA-256 of the canonical request. Replay of the same source identity
  -- returns the original movement only when this matches; a different payload
  -- under the same identity is a conflict, not a replay.
  request_fingerprint text NOT NULL,
  -- Business time as the source states it; `created_at` is when we recorded it.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_tenant_user_id uuid,
  correlation_id text,
  CONSTRAINT awcms_inventory_movements_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inventory_movements_source_key
    UNIQUE (tenant_id, source_type, source_id, source_line, operation),
  CONSTRAINT awcms_inventory_movements_location_fkey
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES awcms_inventory_locations (tenant_id, id),
  CONSTRAINT awcms_inventory_movements_reverses_fkey
    FOREIGN KEY (tenant_id, reverses_movement_id)
    REFERENCES awcms_inventory_movements (tenant_id, id),
  CONSTRAINT awcms_inventory_movements_actor_fkey
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inventory_movements_type_check
    CHECK (movement_type IN (
      'opening', 'receive', 'sale', 'sale_return', 'supplier_return',
      'transfer_out', 'transfer_in', 'adjustment'
    )),
  CONSTRAINT awcms_inventory_movements_operation_check
    CHECK (operation = movement_type
           OR (operation = 'reversal' AND movement_type = 'adjustment')),
  CONSTRAINT awcms_inventory_movements_nonzero_check
    CHECK (quantity_delta <> 0),
  -- The type owns the sign. A `sale` that adds stock is not a data-entry
  -- quirk, it is a corrupted ledger, so the database refuses it.
  CONSTRAINT awcms_inventory_movements_sign_check
    CHECK (
      (movement_type IN ('opening', 'receive', 'sale_return', 'transfer_in')
        AND quantity_delta > 0)
      OR (movement_type IN ('sale', 'supplier_return', 'transfer_out')
        AND quantity_delta < 0)
      OR movement_type = 'adjustment'
    ),
  CONSTRAINT awcms_inventory_movements_transfer_check
    CHECK ((movement_type IN ('transfer_out', 'transfer_in'))
           = (transfer_id IS NOT NULL)),
  CONSTRAINT awcms_inventory_movements_reversal_check
    CHECK (reverses_movement_id IS NULL
           OR (movement_type = 'adjustment' AND operation = 'reversal')),
  CONSTRAINT awcms_inventory_movements_item_type_check
    CHECK (item_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_inventory_movements_item_ref_check
    CHECK (char_length(item_ref) BETWEEN 1 AND 200),
  CONSTRAINT awcms_inventory_movements_unit_check
    CHECK (unit_code ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  CONSTRAINT awcms_inventory_movements_source_bounds
    CHECK (char_length(source_type) BETWEEN 1 AND 64
           AND char_length(source_id) BETWEEN 1 AND 200
           AND char_length(source_line) <= 64),
  CONSTRAINT awcms_inventory_movements_reason_len
    CHECK (reason_code IS NULL OR char_length(reason_code) <= 64),
  CONSTRAINT awcms_inventory_movements_note_len
    CHECK (note IS NULL OR char_length(note) <= 500)
);

-- One `opening` per (location, item): an opening balance is the START of the
-- ledger, so a second one would be a correction in disguise. Corrections are
-- adjustments.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_inventory_movements_opening_key
  ON awcms_inventory_movements (tenant_id, location_id, item_type, item_ref)
  WHERE movement_type = 'opening';

-- A movement is compensated at most once.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_inventory_movements_reversal_key
  ON awcms_inventory_movements (tenant_id, reverses_movement_id)
  WHERE reverses_movement_id IS NOT NULL;

-- Per-item history AND the reconciliation aggregate. INCLUDE (quantity_delta)
-- lets `SUM(quantity_delta) GROUP BY item` run as an index-only scan, which is
-- what keeps reconciliation from reading the heap of the whole ledger.
-- Its leading (tenant_id, location_id) also serves the composite FK.
CREATE INDEX IF NOT EXISTS awcms_inventory_movements_item_idx
  ON awcms_inventory_movements
  (tenant_id, location_id, item_type, item_ref, created_at DESC, id DESC)
  INCLUDE (quantity_delta);

-- Tenant-wide newest-first listing (keyset on created_at, id).
CREATE INDEX IF NOT EXISTS awcms_inventory_movements_list_idx
  ON awcms_inventory_movements (tenant_id, created_at DESC, id DESC);

-- Pair lookup + the deferred balance check below.
CREATE INDEX IF NOT EXISTS awcms_inventory_movements_transfer_idx
  ON awcms_inventory_movements (tenant_id, transfer_id)
  WHERE transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inventory_movements_actor_idx
  ON awcms_inventory_movements (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inventory_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inventory_movements_tenant_isolation
  ON awcms_inventory_movements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 5. Low-stock signals (append-only, the reporting projection's source) -------
-- One row each time a balance CROSSES the low-stock line, in either direction.
-- A transition log rather than a state flag because the `reporting` engine's
-- cursor streams are monotonic and append-only by contract: counting `below`
-- rows and `recovered` rows as two counters yields "balances currently low" as
-- their difference and, being a plain re-scan of this table, is rebuildable
-- from an authoritative source.
CREATE TABLE IF NOT EXISTS awcms_inventory_low_stock_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  location_id uuid NOT NULL,
  item_type text NOT NULL,
  item_ref text NOT NULL,
  signal_kind text NOT NULL,
  on_hand numeric(20, 6) NOT NULL,
  threshold numeric(20, 6),
  -- NULL when the crossing was caused by a threshold change rather than a movement.
  movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inventory_low_stock_signals_kind_check
    CHECK (signal_kind IN ('below', 'recovered')),
  CONSTRAINT awcms_inventory_low_stock_signals_location_fkey
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES awcms_inventory_locations (tenant_id, id),
  CONSTRAINT awcms_inventory_low_stock_signals_movement_fkey
    FOREIGN KEY (tenant_id, movement_id)
    REFERENCES awcms_inventory_movements (tenant_id, id)
);

-- The projection's cursor scan: `WHERE tenant_id = $ AND created_at >= cursor
-- ORDER BY created_at`.
CREATE INDEX IF NOT EXISTS awcms_inventory_low_stock_signals_cursor_idx
  ON awcms_inventory_low_stock_signals (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS awcms_inventory_low_stock_signals_location_idx
  ON awcms_inventory_low_stock_signals (tenant_id, location_id, item_type, item_ref);
CREATE INDEX IF NOT EXISTS awcms_inventory_low_stock_signals_movement_idx
  ON awcms_inventory_low_stock_signals (tenant_id, movement_id)
  WHERE movement_id IS NOT NULL;

ALTER TABLE awcms_inventory_low_stock_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inventory_low_stock_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inventory_low_stock_signals_tenant_isolation
  ON awcms_inventory_low_stock_signals
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Immutability -------------------------------------------------------------
-- Two independent layers, because either alone is a control that reads as
-- enforced and is not:
--   * a row trigger, which also stops a role that holds UPDATE/DELETE (a future
--     grant, a maintenance session) — raising 55000 object_not_in_prerequisite_state;
--   * privileges, so the runtime role cannot even attempt it. sql/019 gave
--     `awcms_app` all four verbs on every table via ALTER DEFAULT PRIVILEGES,
--     so omitting them here would withhold nothing: an explicit REVOKE it is.
--
-- TRUNCATE is covered by the REVOKE only, NOT by a trigger. A `BEFORE TRUNCATE`
-- trigger was tried and removed: the integration harness (and any operator's
-- reset tooling) legitimately runs `TRUNCATE <every awcms_ table> CASCADE` as a
-- privileged role, and a trigger that refuses it breaks every suite in the
-- repo for a protection the REVOKE already gives the only role that serves
-- requests. A privileged TRUNCATE is an operator act, not a request-path one.
CREATE OR REPLACE FUNCTION awcms_inventory_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'awcms_inventory: % is append-only; % is not allowed — post a compensating movement instead',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER awcms_inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON awcms_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION awcms_inventory_reject_mutation();

CREATE TRIGGER awcms_inventory_low_stock_signals_append_only
  BEFORE UPDATE OR DELETE ON awcms_inventory_low_stock_signals
  FOR EACH ROW EXECUTE FUNCTION awcms_inventory_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_inventory_movements FROM awcms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_inventory_low_stock_signals FROM awcms_app;
-- No DELETE on balances either: a balance row is the lock target for "the last
-- unit", and deleting one while a concurrent poster waits on it would let two
-- rows for the same key exist. Rebuild UPDATEs it.
REVOKE DELETE ON awcms_inventory_balances FROM awcms_app;

-- 7. A transfer is a BALANCED PAIR, enforced by the database -------------------
-- `transfer_out` and `transfer_in` legs share a `transfer_id`. A deferred
-- constraint trigger checks, at COMMIT, that the id names exactly one out leg
-- and one in leg, for the same item and unit, at two different locations,
-- netting to zero. Deferred so the two INSERTs can happen in either order inside
-- the transaction; a transaction that writes only one leg cannot commit.
CREATE OR REPLACE FUNCTION awcms_inventory_assert_transfer_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legs record;
BEGIN
  IF NEW.transfer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*) AS leg_count,
    count(*) FILTER (WHERE movement_type = 'transfer_out') AS out_count,
    count(*) FILTER (WHERE movement_type = 'transfer_in') AS in_count,
    coalesce(sum(quantity_delta), 0) AS net,
    count(DISTINCT (item_type, item_ref, unit_code)) AS item_count,
    count(DISTINCT location_id) AS location_count
  INTO legs
  FROM awcms_inventory_movements
  WHERE tenant_id = NEW.tenant_id AND transfer_id = NEW.transfer_id;

  IF legs.leg_count <> 2
     OR legs.out_count <> 1
     OR legs.in_count <> 1
     OR legs.net <> 0
     OR legs.item_count <> 1
     OR legs.location_count <> 2 THEN
    RAISE EXCEPTION
      'awcms_inventory: transfer % is not a balanced out/in pair (legs=%, out=%, in=%, net=%)',
      NEW.transfer_id, legs.leg_count, legs.out_count, legs.in_count, legs.net
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER awcms_inventory_movements_transfer_balanced
  AFTER INSERT ON awcms_inventory_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION awcms_inventory_assert_transfer_balanced();

-- 8. A reversal must really reverse its target ---------------------------------
-- The posting code derives a reversal from the adjustment it names, but the
-- database does not take that on trust: a row that claims `reverses_movement_id`
-- must be an adjustment-reversal of an ADJUSTMENT, at the same location, for the
-- same item and unit, with exactly the opposite quantity. Without this, anything
-- that can INSERT (a future code path, a privileged session) could stamp
-- "reversal of X" on an unrelated movement and use the one-reversal-per-target
-- index to lock the real compensation out.
CREATE OR REPLACE FUNCTION awcms_inventory_assert_reversal_matches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original record;
BEGIN
  IF NEW.reverses_movement_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT location_id, item_type, item_ref, unit_code, quantity_delta, operation
  INTO original
  FROM awcms_inventory_movements
  WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_movement_id;

  IF NOT FOUND
     OR original.operation <> 'adjustment'
     OR original.location_id <> NEW.location_id
     OR original.item_type <> NEW.item_type
     OR original.item_ref <> NEW.item_ref
     OR original.unit_code <> NEW.unit_code
     OR original.quantity_delta + NEW.quantity_delta <> 0 THEN
    RAISE EXCEPTION
      'awcms_inventory: movement % is not an exact reversal of adjustment %',
      NEW.id, NEW.reverses_movement_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_inventory_movements_reversal_matches
  BEFORE INSERT ON awcms_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION awcms_inventory_assert_reversal_matches();

-- 9. Worker access for the reporting projection ---------------------------------
-- The `inventory.low_stock` projection reads this table from the reporting
-- engine's incremental worker, which runs as `awcms_worker` when
-- WORKER_DATABASE_URL is set. Without the grant the refresh fails with
-- "permission denied" while every request-path test stays green, because those
-- run as awcms_app. SELECT only: the engine reads sources and writes
-- exclusively to its own awcms_reporting_projection_* tables (the same shape as
-- sql/022's SELECT on awcms_abac_decision_logs for the access-audit projection).
GRANT SELECT ON awcms_inventory_low_stock_signals TO awcms_worker;

COMMENT ON TABLE awcms_inventory_movements IS
  'Issue #887 / ADR-0126 — the append-only stock ledger. Never UPDATE or DELETE (trigger + REVOKE); correct with a compensating movement. item_type/item_ref are opaque consumer references, deliberately not a foreign key.';
COMMENT ON TABLE awcms_inventory_balances IS
  'Issue #887 / ADR-0126 — derived read model: on_hand always equals SUM(awcms_inventory_movements.quantity_delta) for the key. Written only by the posting code under a row lock; reconciliation proves it, rebuild repairs it from the ledger. No endpoint accepts a client-asserted balance.';
COMMENT ON TABLE awcms_inventory_low_stock_signals IS
  'Issue #887 / ADR-0126 — append-only low-stock transitions (below/recovered); the source stream of the inventory.low_stock reporting projection.';
