-- `booking` -- resources, capacity units, schedules and the reservation
-- lifecycle: the Phase-1 FOUNDATION (Issue #937, ADR-0131 as amended by
-- ADR-0135; design in docs/awcms/booking.md section 4 and 8).
--
-- ## What this migration is, and is not
--
-- It is the SCHEMA and the invariants the database itself can hold: tenant
-- isolation (RLS ENABLE + FORCE, composite (tenant_id, id) foreign keys), the
-- reservation state machine as a BEFORE UPDATE trigger, append-only history,
-- and the two exclusion constraints that make double-booking unrepresentable.
-- It is NOT the allocator, the availability search or any HTTP surface: those
-- are Issues #938 to #941. Nothing here is reachable from a route yet, and the
-- module ships `experimental` (feature flag off).
--
-- ## Deliberately NOT in this migration (follow-up, recorded not forgotten)
--
-- `service_requirements`, `resource_blocks` and `staff_assignments` of the
-- design (booking.md section 4) arrive with the slices that need them
-- (offering requirements and blocked nights with the allocator, staff with the
-- workforce port). `awcms_booking_resource_allocations` therefore has no
-- `block_id` yet; the follow-up adds it together with the CHECK "exactly one of
-- item_id / block_id" and the block trigger, as an additive migration.
--
-- ## No money, no product, no customer name (booking.md section 10.2)
--
-- No column of any `awcms_booking_*` table is a price, amount, deposit,
-- balance, payment state, product id or customer name. The customer is the
-- opaque `external_customer_ref` (commerce is the authority, O12) and a commerce
-- adapter records its order in the opaque `external_ref_type` / `external_ref`
-- pair. tests/integration/booking-database.integration.test.ts reads
-- information_schema and fails if a forbidden column name ever appears.
--
-- ## The exclusion constraints (booking.md section 4 and 8.1)
--
-- Two partial GiST exclusion constraints on `awcms_booking_resource_allocations`,
-- one over instants (slot mode) and one over dates (stay mode). They are
-- declarative, hold for every writer, and are not subject to RLS. The unit id is
-- globally unique so the constraints need no tenant term. They need
-- `btree_gist` (uuid equality in GiST), a TRUSTED extension in PostgreSQL 13+
-- that a database owner can create (booking.md section 8.2).
--
-- ## State machine in the database, not only in the handler
--
-- A BEFORE UPDATE trigger on reservations allows exactly the legal transitions
-- and, for each, only the columns it may change (the pattern of sql/174).
-- Terminal states cannot move. History is a separate append-only table.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Composite-FK anchors on tables owned by other modules (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'awcms_tenant_users_tenant_id_id_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'awcms_tenant_users'::regclass
      AND c.contype IN ('u', 'p')
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
          = ARRAY['tenant_id', 'id']
  ) THEN
    ALTER TABLE awcms_tenant_users
      ADD CONSTRAINT awcms_tenant_users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

-- 1. Tenant-wide policy -------------------------------------------------------
-- NULL = module default. Times are LOCAL times for stay resources (section 2.5).
CREATE TABLE IF NOT EXISTS awcms_booking_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  default_hold_seconds integer,
  max_hold_seconds integer,
  max_active_holds_per_customer integer,
  max_active_holds_per_tenant integer,
  min_lead_seconds integer,
  max_horizon_days integer,
  no_show_grace_seconds integer,
  default_timezone text,
  default_check_in_time time,
  default_check_out_time time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_booking_settings_hold_check
    CHECK ((default_hold_seconds IS NULL OR default_hold_seconds BETWEEN 60 AND 86400)
       AND (max_hold_seconds IS NULL OR max_hold_seconds BETWEEN 60 AND 86400)
       AND (default_hold_seconds IS NULL OR max_hold_seconds IS NULL
            OR default_hold_seconds <= max_hold_seconds)),
  CONSTRAINT awcms_booking_settings_limits_check
    CHECK ((max_active_holds_per_customer IS NULL OR max_active_holds_per_customer >= 1)
       AND (max_active_holds_per_tenant IS NULL OR max_active_holds_per_tenant >= 1)
       AND (min_lead_seconds IS NULL OR min_lead_seconds >= 0)
       AND (max_horizon_days IS NULL OR max_horizon_days BETWEEN 1 AND 3650)
       AND (no_show_grace_seconds IS NULL OR no_show_grace_seconds >= 0)),
  CONSTRAINT awcms_booking_settings_timezone_check
    CHECK (default_timezone IS NULL
           OR default_timezone ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'),
  CONSTRAINT awcms_booking_settings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_settings_updated_by_idx
  ON awcms_booking_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

-- 2. Resource pools -----------------------------------------------------------
-- A set of interchangeable resources (three treatment rooms).
CREATE TABLE IF NOT EXISTS awcms_booking_resource_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  allocation_policy text NOT NULL DEFAULT 'first_free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_booking_resource_pools_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_resource_pools_code_check
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_booking_resource_pools_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_booking_resource_pools_policy_check
    CHECK (allocation_policy IN ('first_free')),
  CONSTRAINT awcms_booking_resource_pools_delete_reason_len
    CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  CONSTRAINT awcms_booking_resource_pools_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resource_pools_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resource_pools_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resource_pools_restored_by_fkey
    FOREIGN KEY (tenant_id, restored_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_resource_pools_code_key
  ON awcms_booking_resource_pools (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS awcms_booking_resource_pools_created_by_idx
  ON awcms_booking_resource_pools (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resource_pools_updated_by_idx
  ON awcms_booking_resource_pools (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resource_pools_deleted_by_idx
  ON awcms_booking_resource_pools (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resource_pools_restored_by_idx
  ON awcms_booking_resource_pools (tenant_id, restored_by) WHERE restored_by IS NOT NULL;

-- 3. Resources ----------------------------------------------------------------
-- `timezone` is an IANA name; a trigger below validates it against
-- pg_timezone_names (a CHECK cannot read a catalogue view). `booking_mode`
-- decides whether the resource is booked by instants (slot) or dates (stay).
CREATE TABLE IF NOT EXISTS awcms_booking_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  capacity integer NOT NULL DEFAULT 1,
  pool_id uuid,
  timezone text NOT NULL,
  booking_mode text NOT NULL DEFAULT 'slot',
  stay_check_in_time time,
  stay_check_out_time time,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_booking_resources_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_resources_code_check
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_booking_resources_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_booking_resources_kind_check
    CHECK (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT awcms_booking_resources_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT awcms_booking_resources_capacity_check
    CHECK (capacity BETWEEN 1 AND 500),
  -- An IANA name, never an offset or an abbreviation (section 2.2).
  CONSTRAINT awcms_booking_resources_timezone_check
    CHECK (timezone ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'),
  CONSTRAINT awcms_booking_resources_mode_check
    CHECK (booking_mode IN ('slot', 'stay')),
  -- Check-in / check-out local times exist exactly for a stay resource.
  CONSTRAINT awcms_booking_resources_stay_times_check
    CHECK ((booking_mode = 'stay'
            AND stay_check_in_time IS NOT NULL AND stay_check_out_time IS NOT NULL)
        OR (booking_mode = 'slot'
            AND stay_check_in_time IS NULL AND stay_check_out_time IS NULL)),
  CONSTRAINT awcms_booking_resources_delete_reason_len
    CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  CONSTRAINT awcms_booking_resources_pool_fkey
    FOREIGN KEY (tenant_id, pool_id) REFERENCES awcms_booking_resource_pools (tenant_id, id),
  CONSTRAINT awcms_booking_resources_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resources_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resources_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resources_restored_by_fkey
    FOREIGN KEY (tenant_id, restored_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_resources_code_key
  ON awcms_booking_resources (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS awcms_booking_resources_list_idx
  ON awcms_booking_resources (tenant_id, sort_order, id);
CREATE INDEX IF NOT EXISTS awcms_booking_resources_pool_idx
  ON awcms_booking_resources (tenant_id, pool_id) WHERE pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resources_created_by_idx
  ON awcms_booking_resources (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resources_updated_by_idx
  ON awcms_booking_resources (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resources_deleted_by_idx
  ON awcms_booking_resources (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resources_restored_by_idx
  ON awcms_booking_resources (tenant_id, restored_by) WHERE restored_by IS NOT NULL;

-- 4. Resource units -----------------------------------------------------------
-- Exactly `capacity` rows per resource (the allocator creates them with the
-- resource). The ANCHOR of the exclusion constraints: a unit is what is claimed.
CREATE TABLE IF NOT EXISTS awcms_booking_resource_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  resource_id uuid NOT NULL,
  ordinal integer NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_resource_units_tenant_id_key UNIQUE (tenant_id, id),
  -- Lets an allocation prove its unit belongs to the resource it names.
  CONSTRAINT awcms_booking_resource_units_resource_id_key
    UNIQUE (tenant_id, resource_id, id),
  CONSTRAINT awcms_booking_resource_units_ordinal_key
    UNIQUE (resource_id, ordinal),
  CONSTRAINT awcms_booking_resource_units_ordinal_check
    CHECK (ordinal BETWEEN 1 AND 500),
  CONSTRAINT awcms_booking_resource_units_label_len
    CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 100),
  CONSTRAINT awcms_booking_resource_units_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT awcms_booking_resource_units_resource_fkey
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES awcms_booking_resources (tenant_id, id)
);

-- 5. Service offerings --------------------------------------------------------
-- NO price, NO product id. `granularity` mirrors the resources it will use; the
-- shape CHECK keeps a stay offering free of buffers/duration and a time offering
-- free of nights, in both directions (section 2.5).
CREATE TABLE IF NOT EXISTS awcms_booking_service_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  granularity text NOT NULL DEFAULT 'time',
  duration_seconds integer,
  setup_seconds integer,
  cleanup_seconds integer,
  slot_step_seconds integer,
  min_nights integer,
  max_nights integer,
  min_party integer NOT NULL DEFAULT 1,
  max_party integer NOT NULL DEFAULT 1,
  confirmation_mode text NOT NULL DEFAULT 'hold_then_confirm',
  cancellation_cutoff_seconds integer,
  min_lead_seconds integer,
  max_horizon_days integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_booking_service_offerings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_service_offerings_code_check
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  CONSTRAINT awcms_booking_service_offerings_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_booking_service_offerings_granularity_check
    CHECK (granularity IN ('time', 'stay')),
  CONSTRAINT awcms_booking_service_offerings_shape_check
    CHECK (
      (granularity = 'time'
        AND duration_seconds IS NOT NULL AND duration_seconds > 0
        AND setup_seconds IS NOT NULL AND setup_seconds >= 0
        AND cleanup_seconds IS NOT NULL AND cleanup_seconds >= 0
        AND slot_step_seconds IS NOT NULL AND slot_step_seconds > 0
        AND min_nights IS NULL AND max_nights IS NULL)
      OR (granularity = 'stay'
        AND duration_seconds IS NULL AND setup_seconds IS NULL
        AND cleanup_seconds IS NULL AND slot_step_seconds IS NULL
        AND min_nights IS NOT NULL AND min_nights >= 1
        AND max_nights IS NOT NULL AND max_nights BETWEEN min_nights AND 366)
    ),
  CONSTRAINT awcms_booking_service_offerings_party_check
    CHECK (min_party >= 1 AND max_party >= min_party AND max_party <= 500),
  CONSTRAINT awcms_booking_service_offerings_confirmation_check
    CHECK (confirmation_mode IN ('immediate', 'hold_then_confirm')),
  CONSTRAINT awcms_booking_service_offerings_policy_check
    CHECK ((cancellation_cutoff_seconds IS NULL OR cancellation_cutoff_seconds >= 0)
       AND (min_lead_seconds IS NULL OR min_lead_seconds >= 0)
       AND (max_horizon_days IS NULL OR max_horizon_days BETWEEN 1 AND 3650)),
  CONSTRAINT awcms_booking_service_offerings_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT awcms_booking_service_offerings_delete_reason_len
    CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  CONSTRAINT awcms_booking_service_offerings_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_service_offerings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_service_offerings_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_service_offerings_restored_by_fkey
    FOREIGN KEY (tenant_id, restored_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_service_offerings_code_key
  ON awcms_booking_service_offerings (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS awcms_booking_service_offerings_created_by_idx
  ON awcms_booking_service_offerings (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_service_offerings_updated_by_idx
  ON awcms_booking_service_offerings (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_service_offerings_deleted_by_idx
  ON awcms_booking_service_offerings (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_service_offerings_restored_by_idx
  ON awcms_booking_service_offerings (tenant_id, restored_by) WHERE restored_by IS NOT NULL;

-- 6. Schedules and exceptions (EMPTY SHELLS) ----------------------------------
-- Schema only: the closed-schema validation of `rules`, recurrence expansion
-- and the supersede-overlap trigger arrive with the availability slice (#938+).
-- `resource_id` NULL = the tenant default schedule.
CREATE TABLE IF NOT EXISTS awcms_booking_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  resource_id uuid,
  timezone text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_booking_schedules_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_schedules_timezone_check
    CHECK (timezone ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'),
  CONSTRAINT awcms_booking_schedules_window_check
    CHECK (effective_to IS NULL OR effective_from < effective_to),
  CONSTRAINT awcms_booking_schedules_rules_check
    CHECK (jsonb_typeof(rules) = 'object'),
  CONSTRAINT awcms_booking_schedules_status_check
    CHECK (status IN ('active', 'inactive')),
  CONSTRAINT awcms_booking_schedules_resource_fkey
    FOREIGN KEY (tenant_id, resource_id) REFERENCES awcms_booking_resources (tenant_id, id),
  CONSTRAINT awcms_booking_schedules_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_schedules_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_schedules_resource_idx
  ON awcms_booking_schedules (tenant_id, resource_id, effective_from);
CREATE INDEX IF NOT EXISTS awcms_booking_schedules_created_by_idx
  ON awcms_booking_schedules (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_schedules_updated_by_idx
  ON awcms_booking_schedules (tenant_id, updated_by) WHERE updated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_booking_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  schedule_id uuid,
  resource_id uuid,
  local_from date NOT NULL,
  local_to date NOT NULL,
  kind text NOT NULL,
  windows jsonb,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_booking_schedule_exceptions_tenant_id_key UNIQUE (tenant_id, id),
  -- schedule_id XOR resource_id (section 4).
  CONSTRAINT awcms_booking_schedule_exceptions_owner_check
    CHECK (num_nonnulls(schedule_id, resource_id) = 1),
  CONSTRAINT awcms_booking_schedule_exceptions_window_check
    CHECK (local_from < local_to),
  CONSTRAINT awcms_booking_schedule_exceptions_kind_check
    CHECK (kind IN ('closed', 'override_hours')),
  CONSTRAINT awcms_booking_schedule_exceptions_windows_check
    CHECK ((kind = 'override_hours' AND windows IS NOT NULL
            AND jsonb_typeof(windows) = 'array')
        OR (kind = 'closed' AND windows IS NULL)),
  -- A short code, never free text (no personal data in a closure reason).
  CONSTRAINT awcms_booking_schedule_exceptions_reason_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT awcms_booking_schedule_exceptions_schedule_fkey
    FOREIGN KEY (tenant_id, schedule_id) REFERENCES awcms_booking_schedules (tenant_id, id),
  CONSTRAINT awcms_booking_schedule_exceptions_resource_fkey
    FOREIGN KEY (tenant_id, resource_id) REFERENCES awcms_booking_resources (tenant_id, id),
  CONSTRAINT awcms_booking_schedule_exceptions_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_schedule_exceptions_schedule_idx
  ON awcms_booking_schedule_exceptions (tenant_id, schedule_id, local_from)
  WHERE schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_schedule_exceptions_resource_idx
  ON awcms_booking_schedule_exceptions (tenant_id, resource_id, local_from)
  WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_schedule_exceptions_created_by_idx
  ON awcms_booking_schedule_exceptions (tenant_id, created_by) WHERE created_by IS NOT NULL;

-- 7. Reservations -------------------------------------------------------------
-- A hold IS a reservation in `held` with `hold_expires_at` (section 5.1): there
-- is no separate holds table. Payment state is NOT here and neither is any
-- money, product or customer name (header). `external_customer_ref` is opaque.
CREATE TABLE IF NOT EXISTS awcms_booking_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  reservation_no text NOT NULL
    DEFAULT ('BK-' || upper(encode(gen_random_bytes(6), 'hex'))),
  -- Filled by the insert trigger with the row's own id for a root reservation.
  lineage_id uuid NOT NULL,
  rescheduled_from_id uuid,
  superseded_by_id uuid,
  series_id uuid,
  status text NOT NULL,
  external_customer_ref text,
  party_size integer NOT NULL DEFAULT 1,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  hold_expires_at timestamptz,
  source text NOT NULL DEFAULT 'admin',
  external_ref_type text,
  external_ref text,
  customer_note text,
  late_cancellation boolean NOT NULL DEFAULT false,
  cancel_reason_code text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_booking_reservations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_reservations_no_key UNIQUE (tenant_id, reservation_no),
  CONSTRAINT awcms_booking_reservations_no_check
    CHECK (reservation_no ~ '^[A-Z0-9][A-Z0-9-]{3,31}$'),
  CONSTRAINT awcms_booking_reservations_status_check
    CHECK (status IN ('held', 'confirmed', 'checked_in', 'completed',
                      'cancelled', 'rescheduled', 'no_show', 'expired')),
  CONSTRAINT awcms_booking_reservations_interval_check
    CHECK (starts_at < ends_at AND ends_at - starts_at <= interval '366 days'),
  CONSTRAINT awcms_booking_reservations_party_check
    CHECK (party_size BETWEEN 1 AND 500),
  CONSTRAINT awcms_booking_reservations_source_check
    CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- An OPAQUE token (the commerce authority's id), never an email, phone or
  -- name: no '@', no spaces. Personal data all the same (it identifies a person
  -- at the authority): it is severed on erasure and never exported (ADR-0094).
  CONSTRAINT awcms_booking_reservations_customer_ref_format
    CHECK (external_customer_ref IS NULL
           OR external_customer_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  CONSTRAINT awcms_booking_reservations_external_ref_check
    CHECK ((external_ref_type IS NULL AND external_ref IS NULL)
        OR (external_ref_type ~ '^[a-z][a-z0-9_]{0,31}$'
            AND char_length(external_ref) BETWEEN 1 AND 128)),
  CONSTRAINT awcms_booking_reservations_note_len
    CHECK (customer_note IS NULL OR char_length(customer_note) <= 500),
  CONSTRAINT awcms_booking_reservations_cancel_reason_check
    CHECK (cancel_reason_code IS NULL OR cancel_reason_code ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- A hold always carries an expiry; once confirmed (and after) it is cleared.
  CONSTRAINT awcms_booking_reservations_hold_expiry_check
    CHECK ((status IN ('held', 'expired') AND hold_expires_at IS NOT NULL)
        OR (status IN ('confirmed', 'checked_in', 'completed', 'no_show',
                       'rescheduled')
            AND hold_expires_at IS NULL)
        OR status = 'cancelled'),
  -- Lineage: `rescheduled` and only `rescheduled` names its successor.
  CONSTRAINT awcms_booking_reservations_superseded_check
    CHECK ((status = 'rescheduled') = (superseded_by_id IS NOT NULL)),
  CONSTRAINT awcms_booking_reservations_late_cancel_check
    CHECK (NOT late_cancellation OR status = 'cancelled'),
  CONSTRAINT awcms_booking_reservations_cancel_reason_state_check
    CHECK (cancel_reason_code IS NULL OR status = 'cancelled'),
  CONSTRAINT awcms_booking_reservations_rescheduled_from_fkey
    FOREIGN KEY (tenant_id, rescheduled_from_id)
    REFERENCES awcms_booking_reservations (tenant_id, id),
  CONSTRAINT awcms_booking_reservations_superseded_by_fkey
    FOREIGN KEY (tenant_id, superseded_by_id)
    REFERENCES awcms_booking_reservations (tenant_id, id),
  CONSTRAINT awcms_booking_reservations_status_changed_by_fkey
    FOREIGN KEY (tenant_id, status_changed_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_reservations_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_reservations_list_idx
  ON awcms_booking_reservations (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_range_idx
  ON awcms_booking_reservations (tenant_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_lineage_idx
  ON awcms_booking_reservations (tenant_id, lineage_id);
-- The hold-expiry sweep (a later slice) scans live holds by expiry.
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_hold_expiry_idx
  ON awcms_booking_reservations (tenant_id, hold_expires_at)
  WHERE status = 'held';
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_series_idx
  ON awcms_booking_reservations (tenant_id, series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_rescheduled_from_idx
  ON awcms_booking_reservations (tenant_id, rescheduled_from_id)
  WHERE rescheduled_from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_superseded_by_idx
  ON awcms_booking_reservations (tenant_id, superseded_by_id)
  WHERE superseded_by_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_status_changed_by_idx
  ON awcms_booking_reservations (tenant_id, status_changed_by)
  WHERE status_changed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_reservations_created_by_idx
  ON awcms_booking_reservations (tenant_id, created_by) WHERE created_by IS NOT NULL;
-- Natural-key backstop (section 5.2 layer 3): an adapter retrying with a fresh
-- Idempotency-Key cannot create a second LIVE reservation for one external ref.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_reservations_external_ref_key
  ON awcms_booking_reservations (tenant_id, external_ref_type, external_ref)
  WHERE external_ref IS NOT NULL
    AND status IN ('held', 'confirmed', 'checked_in');

-- 8. Reservation items --------------------------------------------------------
-- Immutable after insert. The offering snapshot (name, duration, buffers) is a
-- FACT: editing the offering never rewrites a booking (section 2.3).
CREATE TABLE IF NOT EXISTS awcms_booking_reservation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  reservation_id uuid NOT NULL,
  line_no integer NOT NULL,
  offering_id uuid NOT NULL,
  offering_code text NOT NULL,
  offering_name text NOT NULL,
  granularity text NOT NULL,
  duration_seconds integer,
  setup_seconds integer,
  cleanup_seconds integer,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  check_in_date date,
  check_out_date date,
  nights integer,
  check_in_local_time time,
  check_out_local_time time,
  timezone text,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_reservation_items_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_reservation_items_line_key
    UNIQUE (tenant_id, reservation_id, line_no),
  CONSTRAINT awcms_booking_reservation_items_line_check CHECK (line_no >= 1),
  CONSTRAINT awcms_booking_reservation_items_quantity_check
    CHECK (quantity BETWEEN 1 AND 500),
  CONSTRAINT awcms_booking_reservation_items_granularity_check
    CHECK (granularity IN ('time', 'stay')),
  CONSTRAINT awcms_booking_reservation_items_interval_check
    CHECK (starts_at < ends_at AND ends_at - starts_at <= interval '367 days'),
  -- All stay columns set for a stay item and NULL for a time item (section 4).
  CONSTRAINT awcms_booking_reservation_items_shape_check
    CHECK (
      (granularity = 'time'
        AND duration_seconds IS NOT NULL AND duration_seconds > 0
        AND setup_seconds IS NOT NULL AND setup_seconds >= 0
        AND cleanup_seconds IS NOT NULL AND cleanup_seconds >= 0
        AND check_in_date IS NULL AND check_out_date IS NULL AND nights IS NULL
        AND check_in_local_time IS NULL AND check_out_local_time IS NULL
        AND timezone IS NULL)
      OR (granularity = 'stay'
        AND duration_seconds IS NULL AND setup_seconds IS NULL
        AND cleanup_seconds IS NULL
        AND check_in_date IS NOT NULL AND check_out_date IS NOT NULL
        AND check_in_date < check_out_date
        AND nights = check_out_date - check_in_date
        AND nights BETWEEN 1 AND 366
        AND check_in_local_time IS NOT NULL AND check_out_local_time IS NOT NULL
        AND timezone ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$')
    ),
  CONSTRAINT awcms_booking_reservation_items_reservation_fkey
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES awcms_booking_reservations (tenant_id, id),
  CONSTRAINT awcms_booking_reservation_items_offering_fkey
    FOREIGN KEY (tenant_id, offering_id)
    REFERENCES awcms_booking_service_offerings (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_reservation_items_offering_idx
  ON awcms_booking_reservation_items (tenant_id, offering_id);

-- 9. Resource allocations -----------------------------------------------------
-- One row per claimed unit. `released_*` is the ONLY thing that ever changes,
-- once (trigger). Time rows carry the occupied range (service interval widened
-- by the item's setup/cleanup); stay rows carry the date interval.
CREATE TABLE IF NOT EXISTS awcms_booking_resource_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  item_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_unit_id uuid NOT NULL,
  granularity text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  occupied_from timestamptz,
  occupied_to timestamptz,
  stay_from date,
  stay_to date,
  released_at timestamptz,
  released_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_resource_allocations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_resource_allocations_granularity_check
    CHECK (granularity IN ('time', 'stay')),
  CONSTRAINT awcms_booking_resource_allocations_shape_check
    CHECK (
      (granularity = 'time'
        AND occupied_from IS NOT NULL AND occupied_to IS NOT NULL
        AND occupied_from <= starts_at AND starts_at < ends_at
        AND ends_at <= occupied_to
        AND stay_from IS NULL AND stay_to IS NULL)
      OR (granularity = 'stay'
        AND occupied_from IS NULL AND occupied_to IS NULL
        AND starts_at < ends_at
        AND stay_from IS NOT NULL AND stay_to IS NOT NULL
        AND stay_from < stay_to AND stay_to - stay_from <= 366)
    ),
  CONSTRAINT awcms_booking_resource_allocations_released_check
    CHECK ((released_at IS NULL) = (released_reason IS NULL)),
  CONSTRAINT awcms_booking_resource_allocations_reason_check
    CHECK (released_reason IS NULL
           OR released_reason IN ('cancelled', 'expired', 'rescheduled')),
  CONSTRAINT awcms_booking_resource_allocations_item_fkey
    FOREIGN KEY (tenant_id, item_id)
    REFERENCES awcms_booking_reservation_items (tenant_id, id),
  -- The unit must belong to the resource the row names (and to this tenant).
  CONSTRAINT awcms_booking_resource_allocations_unit_fkey
    FOREIGN KEY (tenant_id, resource_id, resource_unit_id)
    REFERENCES awcms_booking_resource_units (tenant_id, resource_id, id),
  -- Slot mode: no two LIVE overlapping occupied ranges on one unit (half-open).
  CONSTRAINT awcms_booking_resource_allocations_time_excl
    EXCLUDE USING gist (
      resource_unit_id WITH =,
      tstzrange(occupied_from, occupied_to, '[)') WITH &&
    ) WHERE (released_at IS NULL AND granularity = 'time'),
  -- Stay mode: no two LIVE overlapping date intervals on one unit. A daterange
  -- is discrete, so [10th, 12th) and [12th, 14th) are adjacent (same-day turnover).
  CONSTRAINT awcms_booking_resource_allocations_stay_excl
    EXCLUDE USING gist (
      resource_unit_id WITH =,
      daterange(stay_from, stay_to, '[)') WITH &&
    ) WHERE (released_at IS NULL AND granularity = 'stay')
);

CREATE INDEX IF NOT EXISTS awcms_booking_resource_allocations_item_idx
  ON awcms_booking_resource_allocations (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS awcms_booking_resource_allocations_unit_idx
  ON awcms_booking_resource_allocations (tenant_id, resource_id, resource_unit_id)
  WHERE released_at IS NULL;

-- 10. Reservation events (APPEND-ONLY history) --------------------------------
-- One row per transition, written in the same transaction as the transition.
-- `detail` carries closed keys (ids, instants, counts): NO free text and NO
-- personal data, by construction (section 4, data-subject answers).
CREATE TABLE IF NOT EXISTS awcms_booking_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  reservation_id uuid NOT NULL,
  seq integer NOT NULL,
  kind text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid,
  correlation_id uuid,
  reason_code text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_reservation_events_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_reservation_events_seq_key
    UNIQUE (tenant_id, reservation_id, seq),
  -- Each kind happens at most once to a reservation: it reaches a state once.
  CONSTRAINT awcms_booking_reservation_events_kind_once_key
    UNIQUE (tenant_id, reservation_id, kind),
  CONSTRAINT awcms_booking_reservation_events_seq_check CHECK (seq >= 1),
  CONSTRAINT awcms_booking_reservation_events_kind_check
    CHECK (kind IN ('created', 'held', 'confirmed', 'rescheduled', 'cancelled',
                    'checked_in', 'completed', 'no_show', 'expired')),
  CONSTRAINT awcms_booking_reservation_events_status_check
    CHECK (to_status IN ('held', 'confirmed', 'checked_in', 'completed',
                         'cancelled', 'rescheduled', 'no_show', 'expired')
       AND (from_status IS NULL
            OR from_status IN ('held', 'confirmed', 'checked_in', 'completed',
                               'cancelled', 'rescheduled', 'no_show', 'expired'))),
  -- `created` has no predecessor. The `held` / `confirmed` rows appended in the
  -- same transaction as a creation may carry none either, so this is one-way.
  CONSTRAINT awcms_booking_reservation_events_created_shape_check
    CHECK (kind <> 'created' OR from_status IS NULL),
  CONSTRAINT awcms_booking_reservation_events_reason_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT awcms_booking_reservation_events_detail_check
    CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT awcms_booking_reservation_events_reservation_fkey
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES awcms_booking_reservations (tenant_id, id),
  CONSTRAINT awcms_booking_reservation_events_actor_fkey
    FOREIGN KEY (tenant_id, actor_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_reservation_events_cursor_idx
  ON awcms_booking_reservation_events (tenant_id, created_at, id);
CREATE INDEX IF NOT EXISTS awcms_booking_reservation_events_actor_idx
  ON awcms_booking_reservation_events (tenant_id, actor_user_id)
  WHERE actor_user_id IS NOT NULL;

-- 11. Row-level security: ENABLE + FORCE on every table -----------------------
-- Written out per table (not a DO loop) so the table-RLS derivation that gates
-- `FORCE` (scripts/lib/table-rls-states.ts) reads literal statements.
ALTER TABLE awcms_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_settings_tenant_isolation
  ON awcms_booking_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_resource_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_pools FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_resource_pools_tenant_isolation
  ON awcms_booking_resource_pools
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_resources_tenant_isolation
  ON awcms_booking_resources
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_resource_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_units FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_resource_units_tenant_isolation
  ON awcms_booking_resource_units
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_service_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_service_offerings FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_service_offerings_tenant_isolation
  ON awcms_booking_service_offerings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_schedules_tenant_isolation
  ON awcms_booking_schedules
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_schedule_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_schedule_exceptions_tenant_isolation
  ON awcms_booking_schedule_exceptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_reservations_tenant_isolation
  ON awcms_booking_reservations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_reservation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reservation_items FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_reservation_items_tenant_isolation
  ON awcms_booking_reservation_items
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_resource_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_resource_allocations_tenant_isolation
  ON awcms_booking_resource_allocations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_booking_reservation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reservation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_reservation_events_tenant_isolation
  ON awcms_booking_reservation_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 12. Immutability and privileges ---------------------------------------------
-- Two independent layers (sql/169, sql/174): a row trigger (stops a role that
-- holds the privilege) AND a REVOKE (the runtime role cannot even attempt it).
CREATE OR REPLACE FUNCTION awcms_booking_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'awcms_booking: % is append-only; % is not allowed',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER awcms_booking_reservation_events_append_only
  BEFORE UPDATE OR DELETE ON awcms_booking_reservation_events
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();
CREATE TRIGGER awcms_booking_reservation_items_append_only
  BEFORE UPDATE OR DELETE ON awcms_booking_reservation_items
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();

-- Nothing here is ever deleted: a reservation is cancelled, a resource is
-- soft-deleted, an allocation is released.
CREATE TRIGGER awcms_booking_reservations_no_delete
  BEFORE DELETE ON awcms_booking_reservations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();
CREATE TRIGGER awcms_booking_resource_allocations_no_delete
  BEFORE DELETE ON awcms_booking_resource_allocations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();
CREATE TRIGGER awcms_booking_resources_no_delete
  BEFORE DELETE ON awcms_booking_resources
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();
CREATE TRIGGER awcms_booking_resource_units_no_delete
  BEFORE DELETE ON awcms_booking_resource_units
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_booking_reservation_events FROM awcms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_booking_reservation_items FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_reservations FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_resource_allocations FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_resources FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_resource_units FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_resource_pools FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_service_offerings FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_schedules FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_booking_settings FROM awcms_app;
-- Schedule exceptions are configuration with no history value: DELETE stays.
REVOKE TRUNCATE ON awcms_booking_schedule_exceptions FROM awcms_app;

-- 13. Reservation lifecycle ---------------------------------------------------
-- BEFORE INSERT: a reservation is born `held` or `confirmed` (immediate
-- confirmation), never in a later state; a root reservation is its own lineage.
CREATE OR REPLACE FUNCTION awcms_booking_guard_reservation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('held', 'confirmed') THEN
    RAISE EXCEPTION
      'awcms_booking: a reservation is created held or confirmed, not %', NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF NEW.lineage_id IS NULL THEN
    NEW.lineage_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- NOT NULL is checked AFTER BEFORE-row triggers, so an INSERT that omits
-- lineage_id reaches the trigger as NULL and leaves it filled.
CREATE TRIGGER awcms_booking_reservations_insert_guard
  BEFORE INSERT ON awcms_booking_reservations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_reservation_insert();

-- BEFORE UPDATE: exactly the legal transitions, and for each only the columns
-- it may change; everything else must be byte-identical (compared as jsonb so a
-- column added later is covered by default rather than silently exempt).
--
--   held       -> held         hold_expires_at may only move LATER (extend)
--   held       -> confirmed    the hold must not be expired; expiry cleared
--   held       -> expired      the hold must be past its expiry
--   held       -> cancelled
--   confirmed  -> cancelled | rescheduled | checked_in | no_show
--   checked_in -> completed
--
-- cancelled, rescheduled, completed, no_show and expired are terminal. The
-- privacy columns may only be severed (set to NULL) at any time (ADR-0094).
CREATE OR REPLACE FUNCTION awcms_booking_guard_reservation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed text[];
  transition text := OLD.status || '->' || NEW.status;
  base text[] := ARRAY['status_changed_at', 'status_changed_by', 'updated_at'];
BEGIN
  allowed := CASE transition
    WHEN 'held->held' THEN base || ARRAY['hold_expires_at']
    WHEN 'held->confirmed' THEN base || ARRAY['status', 'hold_expires_at']
    WHEN 'held->expired' THEN base || ARRAY['status']
    WHEN 'held->cancelled' THEN base || ARRAY[
      'status', 'late_cancellation', 'cancel_reason_code']
    WHEN 'confirmed->confirmed' THEN base
    WHEN 'confirmed->cancelled' THEN base || ARRAY[
      'status', 'late_cancellation', 'cancel_reason_code']
    WHEN 'confirmed->rescheduled' THEN base || ARRAY['status', 'superseded_by_id']
    WHEN 'confirmed->checked_in' THEN base || ARRAY['status']
    WHEN 'confirmed->no_show' THEN base || ARRAY['status']
    WHEN 'checked_in->completed' THEN base || ARRAY['status']
    WHEN 'checked_in->checked_in' THEN base
    WHEN 'completed->completed' THEN base
    WHEN 'cancelled->cancelled' THEN base
    WHEN 'rescheduled->rescheduled' THEN base
    WHEN 'no_show->no_show' THEN base
    WHEN 'expired->expired' THEN base
    ELSE NULL
  END;

  IF allowed IS NULL THEN
    RAISE EXCEPTION
      'awcms_booking: illegal reservation transition % for reservation %',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- Severing personal references is always allowed, and only to NULL.
  IF NEW.customer_note IS DISTINCT FROM OLD.customer_note
     AND NEW.customer_note IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: customer_note may only be cleared (reservation %)', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF NEW.external_customer_ref IS DISTINCT FROM OLD.external_customer_ref
     AND NEW.external_customer_ref IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: external_customer_ref may only be severed (reservation %)', OLD.id
      USING ERRCODE = '55000';
  END IF;
  allowed := allowed || ARRAY['customer_note', 'external_customer_ref'];

  IF transition = 'held->held'
     AND NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at
     AND NEW.hold_expires_at <= OLD.hold_expires_at THEN
    RAISE EXCEPTION
      'awcms_booking: a hold may only be extended, not shortened (reservation %)', OLD.id
      USING ERRCODE = '55000';
  END IF;
  -- An already-expired hold cannot be revived by extending it (its units may
  -- have been reclaimed): extension is for a hold that is still live.
  IF transition = 'held->held'
     AND NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at
     AND OLD.hold_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'awcms_booking: HOLD_EXPIRED: an expired hold cannot be extended (reservation %)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- The database clock is the only clock (section 5.1).
  IF transition = 'held->confirmed'
     AND OLD.hold_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION
      'awcms_booking: HOLD_EXPIRED: reservation % hold expired at %',
      OLD.id, OLD.hold_expires_at
      USING ERRCODE = '55000';
  END IF;
  IF transition = 'held->expired'
     AND OLD.hold_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION
      'awcms_booking: reservation % hold has not expired yet', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'awcms_booking: transition % may not change any column outside its allowed set (reservation %)',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_reservations_update_guard
  BEFORE UPDATE ON awcms_booking_reservations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_reservation_update();

-- 14. Resource guards ---------------------------------------------------------
-- (a) the IANA name must exist in the runtime tz database (a CHECK cannot read
-- pg_timezone_names); (b) booking_mode is immutable while the resource has live
-- allocations; (c) so is the timezone of a stay resource (a date only means
-- something in its zone, section 2.5).
CREATE OR REPLACE FUNCTION awcms_booking_guard_resource_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
      RAISE EXCEPTION 'awcms_booking: TIMEZONE_INVALID: %', NEW.timezone
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.booking_mode IS DISTINCT FROM OLD.booking_mode
          OR (OLD.booking_mode = 'stay'
              AND NEW.timezone IS DISTINCT FROM OLD.timezone)) THEN
    IF EXISTS (
      SELECT 1 FROM awcms_booking_resource_allocations
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND released_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'awcms_booking: TIMEZONE_IN_USE: resource % has live allocations', OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resources_write_guard
  BEFORE INSERT OR UPDATE ON awcms_booking_resources
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_resource_write();

-- 15. Item and allocation guards ----------------------------------------------
-- An item is only added to a live reservation. FOR SHARE: a concurrent cancel
-- holds FOR UPDATE on the reservation, so an item insert racing it waits for the
-- verdict instead of reading a stale status (sql/174's line guard).
CREATE OR REPLACE FUNCTION awcms_booking_guard_item_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
  FROM awcms_booking_reservations
  WHERE tenant_id = NEW.tenant_id AND id = NEW.reservation_id
  FOR SHARE;

  IF parent_status IS NULL OR parent_status NOT IN ('held', 'confirmed') THEN
    RAISE EXCEPTION
      'awcms_booking: items may only be added to a held or confirmed reservation (reservation %)',
      NEW.reservation_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_reservation_items_insert_guard
  BEFORE INSERT ON awcms_booking_reservation_items
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_item_insert();

-- An allocation must agree with its item and its resource: the granularity is
-- the resource's booking_mode (so the two exclusion constraints partition the
-- unit space), and the instants / buffers / dates equal the item's snapshot.
CREATE OR REPLACE FUNCTION awcms_booking_guard_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item awcms_booking_reservation_items%ROWTYPE;
  res_mode text;
  res_status text;
  res_deleted timestamptz;
  unit_status text;
  parent_status text;
BEGIN
  -- FOR SHARE on the resource: a concurrent booking_mode / timezone change
  -- (which takes the row for UPDATE) waits for this allocation, or this one
  -- waits for it, instead of racing it.
  SELECT booking_mode, status, deleted_at
    INTO res_mode, res_status, res_deleted
  FROM awcms_booking_resources
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_id
  FOR SHARE;

  IF res_status IS DISTINCT FROM 'active' OR res_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: resource % is inactive or deleted and cannot be allocated',
      NEW.resource_id
      USING ERRCODE = '55000';
  END IF;

  SELECT status INTO unit_status
  FROM awcms_booking_resource_units
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_unit_id
  FOR SHARE;

  IF unit_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'awcms_booking: unit % is not active and cannot be allocated',
      NEW.resource_unit_id
      USING ERRCODE = '55000';
  END IF;

  -- A live allocation exists only under a held or confirmed reservation. FOR
  -- SHARE, like the item guard: a concurrent cancel holds the reservation FOR
  -- UPDATE, so this insert waits for the verdict instead of reading a stale one.
  SELECT r.status INTO parent_status
  FROM awcms_booking_reservation_items i
  JOIN awcms_booking_reservations r
    ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
  WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id
  FOR SHARE OF r;

  IF parent_status IS NULL OR parent_status NOT IN ('held', 'confirmed') THEN
    RAISE EXCEPTION
      'awcms_booking: allocations may only be added to a held or confirmed reservation (item %)',
      NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  -- The resource says `slot`/`stay`, the allocation `time`/`stay`: one concept,
  -- two spellings (booking.md section 4), mapped here and nowhere else.
  IF (CASE res_mode WHEN 'slot' THEN 'time' ELSE res_mode END)
     IS DISTINCT FROM NEW.granularity THEN
    RAISE EXCEPTION
      'awcms_booking: allocation granularity % does not match resource booking_mode %',
      NEW.granularity, res_mode
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO item
  FROM awcms_booking_reservation_items
  WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;

  IF item.id IS NULL
     OR item.granularity <> NEW.granularity
     OR item.starts_at <> NEW.starts_at
     OR item.ends_at <> NEW.ends_at THEN
    RAISE EXCEPTION
      'awcms_booking: allocation disagrees with its item (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.granularity = 'time'
     AND (NEW.occupied_from <> item.starts_at - make_interval(secs => item.setup_seconds)
          OR NEW.occupied_to <> item.ends_at + make_interval(secs => item.cleanup_seconds)) THEN
    RAISE EXCEPTION
      'awcms_booking: allocation buffer does not equal the item snapshot (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.granularity = 'stay'
     AND (NEW.stay_from <> item.check_in_date OR NEW.stay_to <> item.check_out_date) THEN
    RAISE EXCEPTION
      'awcms_booking: allocation dates differ from the item stay (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resource_allocations_insert_guard
  BEFORE INSERT ON awcms_booking_resource_allocations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_allocation_insert();

-- Only `released_at` / `released_reason` may change, and only once.
CREATE OR REPLACE FUNCTION awcms_booking_guard_allocation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: allocation % is already released', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['released_at', 'released_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['released_at', 'released_reason']) THEN
    RAISE EXCEPTION
      'awcms_booking: only released_at / released_reason may change on an allocation (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resource_allocations_update_guard
  BEFORE UPDATE ON awcms_booking_resource_allocations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_allocation_update();

-- 16. Worker access for the (later) reporting projections ---------------------
-- The reporting engine reads the append-only event log as `awcms_worker`.
-- SELECT only (the engine writes exclusively to its own projection tables).
GRANT SELECT ON awcms_booking_reservation_events TO awcms_worker;

COMMENT ON TABLE awcms_booking_reservations IS
  'Issue #937 / ADR-0131 -- reservation header; a hold is a reservation in held with hold_expires_at. State machine enforced by trigger; never deleted; no money, product id or customer name.';
COMMENT ON TABLE awcms_booking_reservation_items IS
  'Issue #937 / ADR-0131 -- immutable item snapshot of what was booked (offering name, duration, buffers, stay dates).';
COMMENT ON TABLE awcms_booking_resource_allocations IS
  'Issue #937 / ADR-0131, ADR-0135 -- one row per claimed unit; the two exclusion constraints make double-booking unrepresentable. Only released_* ever changes, once.';
COMMENT ON TABLE awcms_booking_reservation_events IS
  'Issue #937 / ADR-0131 -- append-only transition history; closed-key detail, no free text, no personal data.';
