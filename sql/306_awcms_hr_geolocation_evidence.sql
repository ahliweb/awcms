-- `hr_workforce` geolocation attendance evidence — verdict-only, off by default,
-- short retention (Issue #970, ADR-0138; owner decision O6).
--
-- ## The shape, in one paragraph
--
-- A tenant may turn on ONE per-tenant switch (`awcms_hr_geolocation_settings.
-- enabled`, FALSE for every tenant, never set by a migration, a seed or an
-- environment variable). While it is on, a `self` clock_in / clock_out may carry
-- one position sample. The SERVER evaluates it IN THE REQUEST against the
-- geofences of the event's office (`awcms_hr_geofences`, a work-site circle or
-- small polygon) and DISCARDS the coordinates. Only a VERDICT survives
-- (`awcms_hr_attendance_location_evidence`: inside / outside / not_provided, a
-- coarse distance band, a coarse accuracy band, the geofence reference, the rule
-- version and the server time). There is NO coordinate, raw accuracy, altitude,
-- speed, heading, address, device or network identifier, photo or biometric in
-- any column of the evidence table, and none on the attendance event (sql/198 is
-- untouched).
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * DEFAULT OFF: `enabled` defaults FALSE and this migration inserts no row.
--     The evidence guard REFUSES an insert while the tenant's switch is off, so
--     disabling stops capture at once even for an in-flight request.
--   * ENABLING NEEDS ITS PRECONDITIONS IN THE DATA: a CHECK requires a DPIA
--     reference + date and a published notice; a trigger requires at least one
--     live geofence. Disabling has no precondition.
--   * ONLY `source = self` AT clock_in / clock_out may have evidence, one row per
--     event at most, and the employment is stamped from the event (a writer
--     cannot claim another person's). `evaluated_at` is the database clock.
--   * APPEND-ONLY for `awcms_app`: no UPDATE, DELETE or TRUNCATE (privilege), and
--     a trigger refuses UPDATE for every role. Rows leave only through the
--     retention engine, which runs as `awcms_worker` (the generic hard_delete
--     path, legal-hold aware) -- the event they describe is untouched.
--   * NOTICE VERSIONS are append-only; an ACKNOWLEDGEMENT is written only for
--     the employment's own linked login, once per (employment, notice version).
--
-- ## Classification
--
-- Evidence rows are RESTRICTED personal data (a person's presence at a site):
-- 30 / 90 / 180 days, hard delete, no archive, legal hold overrides. A geofence
-- describes a place of business, not a person, and is internal. Notices are
-- tenant-authored text. Every reference is a composite `(tenant_id, ...)`
-- foreign key. Every table: RLS ENABLE + FORCE with a USING/WITH CHECK policy.

-- 1. Notice versions -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_geolocation_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  version integer NOT NULL,
  -- Locale -> notice text, authored by the tenant: what is captured, when, for
  -- what, who can see it, how long it is kept, and that declining does not stop
  -- clocking in.
  texts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_hr_geolocation_notices_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_geolocation_notices_version_key UNIQUE (tenant_id, version),
  CONSTRAINT awcms_hr_geolocation_notices_version_check CHECK (version >= 1),
  CONSTRAINT awcms_hr_geolocation_notices_texts_check
    CHECK (jsonb_typeof(texts) = 'object' AND texts <> '{}'::jsonb),
  CONSTRAINT awcms_hr_geolocation_notices_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_notices_created_by_idx
  ON awcms_hr_geolocation_notices (tenant_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_notices_list_idx
  ON awcms_hr_geolocation_notices (tenant_id, created_at DESC);

ALTER TABLE awcms_hr_geolocation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_geolocation_notices FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_geolocation_notices_tenant_isolation
  ON awcms_hr_geolocation_notices
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_hr_geolocation_notices FROM awcms_app;

CREATE TRIGGER awcms_hr_geolocation_notices_no_update
  BEFORE UPDATE ON awcms_hr_geolocation_notices
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_geolocation_notices_no_delete
  BEFORE DELETE ON awcms_hr_geolocation_notices
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- 2. Geofences -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  office_id uuid NOT NULL,
  label text NOT NULL,
  shape text NOT NULL,
  -- circle: centre + radius.
  center_latitude double precision,
  center_longitude double precision,
  radius_m integer,
  -- polygon: a jsonb array of [latitude, longitude] pairs, 3 to 32 vertices.
  vertices jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  -- Bumped by every replace; the audit row carries it with a geometry hash.
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT awcms_hr_geofences_revision_check CHECK (revision >= 1),
  CONSTRAINT awcms_hr_geofences_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_geofences_label_check
    CHECK (char_length(label) BETWEEN 1 AND 80 AND btrim(label) <> ''),
  CONSTRAINT awcms_hr_geofences_shape_check
    CHECK (shape IN ('circle', 'polygon')),
  CONSTRAINT awcms_hr_geofences_circle_check
    CHECK (shape <> 'circle' OR (
      center_latitude BETWEEN -90 AND 90
      AND center_longitude BETWEEN -180 AND 180
      AND radius_m BETWEEN 50 AND 5000
      AND vertices IS NULL)),
  CONSTRAINT awcms_hr_geofences_polygon_check
    CHECK (shape <> 'polygon' OR (
      center_latitude IS NULL AND center_longitude IS NULL AND radius_m IS NULL
      AND vertices IS NOT NULL
      AND jsonb_typeof(vertices) = 'array'
      AND jsonb_array_length(vertices) BETWEEN 3 AND 32)),
  CONSTRAINT awcms_hr_geofences_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_hr_geofences_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_geofences_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_geofences_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_geofences_office_idx
  ON awcms_hr_geofences (tenant_id, office_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_geofences_list_idx
  ON awcms_hr_geofences (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_geofences_created_by_idx
  ON awcms_hr_geofences (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_geofences_updated_by_idx
  ON awcms_hr_geofences (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_geofences_deleted_by_idx
  ON awcms_hr_geofences (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;

ALTER TABLE awcms_hr_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_geofences FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_geofences_tenant_isolation
  ON awcms_hr_geofences
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Soft delete only (deleted_at); a geofence an evidence row references is never
-- removed.
REVOKE DELETE, TRUNCATE ON awcms_hr_geofences FROM awcms_app;

CREATE TRIGGER awcms_hr_geofences_no_delete
  BEFORE DELETE ON awcms_hr_geofences
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- 3. The per-tenant switch -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_geolocation_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- FALSE for every tenant, always. Nothing in this repository sets it.
  enabled boolean NOT NULL DEFAULT false,
  -- A sample whose reported accuracy is worse than this is `not_provided`.
  accuracy_ceiling_m integer NOT NULL DEFAULT 100,
  -- A REFERENCE to the tenant's data-protection impact assessment (a document
  -- identifier and its date), never its content.
  dpia_reference text,
  dpia_recorded_on date,
  -- The published notice version employees must have acknowledged.
  notice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_hr_geolocation_settings_ceiling_check
    CHECK (accuracy_ceiling_m BETWEEN 10 AND 500),
  CONSTRAINT awcms_hr_geolocation_settings_dpia_check
    CHECK (dpia_reference IS NULL
           OR (char_length(dpia_reference) BETWEEN 1 AND 200
               AND btrim(dpia_reference) <> '')),
  -- Turning it ON needs all of these in the data; turning it OFF needs nothing.
  CONSTRAINT awcms_hr_geolocation_settings_enable_check
    CHECK (NOT enabled OR (
      dpia_reference IS NOT NULL AND dpia_recorded_on IS NOT NULL
      AND notice_id IS NOT NULL)),
  CONSTRAINT awcms_hr_geolocation_settings_notice_fkey
    FOREIGN KEY (tenant_id, notice_id)
    REFERENCES awcms_hr_geolocation_notices (tenant_id, id),
  CONSTRAINT awcms_hr_geolocation_settings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_settings_notice_idx
  ON awcms_hr_geolocation_settings (tenant_id, notice_id)
  WHERE notice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_settings_updated_by_idx
  ON awcms_hr_geolocation_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

ALTER TABLE awcms_hr_geolocation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_geolocation_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_geolocation_settings_tenant_isolation
  ON awcms_hr_geolocation_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_hr_geolocation_settings FROM awcms_app;

-- Enabling needs at least one live geofence (a CHECK cannot read another table).
CREATE OR REPLACE FUNCTION awcms_hr_guard_geolocation_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (
    SELECT 1 FROM awcms_hr_geofences g
     WHERE g.tenant_id = NEW.tenant_id AND g.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'awcms_hr: HR_GEO_NO_GEOFENCE' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_geolocation_settings_guard
  BEFORE INSERT OR UPDATE ON awcms_hr_geolocation_settings
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_geolocation_settings();

-- 4. Notice acknowledgements ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_geolocation_notice_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  employment_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  -- The login of the employee who acknowledged (the guard checks the link).
  acknowledged_by uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT awcms_hr_geolocation_acks_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_geolocation_acks_once_key
    UNIQUE (tenant_id, employment_id, notice_id),
  CONSTRAINT awcms_hr_geolocation_acks_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_geolocation_acks_notice_fkey
    FOREIGN KEY (tenant_id, notice_id)
    REFERENCES awcms_hr_geolocation_notices (tenant_id, id),
  CONSTRAINT awcms_hr_geolocation_acks_by_fkey
    FOREIGN KEY (tenant_id, acknowledged_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_acks_notice_idx
  ON awcms_hr_geolocation_notice_acknowledgements (tenant_id, notice_id);
CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_acks_by_idx
  ON awcms_hr_geolocation_notice_acknowledgements (tenant_id, acknowledged_by);
CREATE INDEX IF NOT EXISTS awcms_hr_geolocation_acks_list_idx
  ON awcms_hr_geolocation_notice_acknowledgements (tenant_id, acknowledged_at);

ALTER TABLE awcms_hr_geolocation_notice_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_geolocation_notice_acknowledgements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_geolocation_acks_tenant_isolation
  ON awcms_hr_geolocation_notice_acknowledgements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE
  ON awcms_hr_geolocation_notice_acknowledgements FROM awcms_app;

CREATE TRIGGER awcms_hr_geolocation_acks_no_update
  BEFORE UPDATE ON awcms_hr_geolocation_notice_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_geolocation_acks_no_delete
  BEFORE DELETE ON awcms_hr_geolocation_notice_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- An acknowledgement is the EMPLOYEE's own act: the acknowledging login must be
-- the login linked to a live employment.
CREATE OR REPLACE FUNCTION awcms_hr_guard_geolocation_ack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  linked uuid;
  gone timestamptz;
  present boolean;
BEGIN
  NEW.acknowledged_at := clock_timestamp();

  SELECT e.tenant_user_id, e.deleted_at, true
    INTO linked, gone, present
    FROM awcms_hr_employments e
   WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employment_id
   FOR SHARE;

  IF present IS TRUE AND (gone IS NOT NULL
                          OR linked IS DISTINCT FROM NEW.acknowledged_by) THEN
    RAISE EXCEPTION 'awcms_hr: HR_GEO_ACK_NOT_OWN' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_geolocation_acks_guard
  BEFORE INSERT ON awcms_hr_geolocation_notice_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_geolocation_ack();

-- 5. The evidence ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_attendance_location_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The attendance event this describes. At most one row per event.
  event_id uuid NOT NULL,
  -- Stamped from the event by the guard (the subject path for export / access).
  employment_id uuid NOT NULL,
  verdict text NOT NULL,
  -- Coarse bands ONLY. No coordinate, no raw accuracy, no distance in metres.
  distance_band text,
  accuracy_band text,
  geofence_id uuid,
  rule_version smallint NOT NULL,
  -- The DATABASE clock; the retention cursor.
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT awcms_hr_attendance_location_evidence_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_location_evidence_one_per_event
    UNIQUE (tenant_id, event_id),
  CONSTRAINT awcms_hr_attendance_location_evidence_verdict_check
    CHECK (verdict IN ('inside', 'outside', 'not_provided')),
  CONSTRAINT awcms_hr_attendance_location_evidence_distance_check
    CHECK (distance_band IS NULL
           OR distance_band IN ('within', 'lt_250m', 'lt_1km', 'gte_1km')),
  CONSTRAINT awcms_hr_attendance_location_evidence_accuracy_check
    CHECK (accuracy_band IS NULL
           OR accuracy_band IN ('lt_25m', 'lt_100m', 'lt_500m', 'gte_500m')),
  CONSTRAINT awcms_hr_attendance_location_evidence_rule_check
    CHECK (rule_version >= 1),
  -- `inside` / `outside` always name the nearest geofence and both bands;
  -- `not_provided` names no geofence and no distance (never counted as inside).
  CONSTRAINT awcms_hr_attendance_location_evidence_shape_check
    CHECK (
      (verdict = 'not_provided' AND distance_band IS NULL AND geofence_id IS NULL)
      OR (verdict = 'inside' AND distance_band = 'within'
          AND accuracy_band IS NOT NULL AND geofence_id IS NOT NULL)
      OR (verdict = 'outside' AND distance_band IN ('lt_250m', 'lt_1km', 'gte_1km')
          AND accuracy_band IS NOT NULL AND geofence_id IS NOT NULL)),
  CONSTRAINT awcms_hr_attendance_location_evidence_event_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES awcms_hr_attendance_events (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_location_evidence_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_location_evidence_geofence_fkey
    FOREIGN KEY (tenant_id, geofence_id)
    REFERENCES awcms_hr_geofences (tenant_id, id)
);

-- The retention engine's (tenant, cursor) composite, and the per-person read.
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_location_evidence_retention_idx
  ON awcms_hr_attendance_location_evidence (tenant_id, evaluated_at);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_location_evidence_employment_idx
  ON awcms_hr_attendance_location_evidence
  (tenant_id, employment_id, evaluated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_location_evidence_geofence_idx
  ON awcms_hr_attendance_location_evidence (tenant_id, geofence_id)
  WHERE geofence_id IS NOT NULL;

ALTER TABLE awcms_hr_attendance_location_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_attendance_location_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_attendance_location_evidence_tenant_isolation
  ON awcms_hr_attendance_location_evidence
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Append-only for the request role, by privilege AND by trigger. Rows are removed
-- only by the retention engine (awcms_worker), below.
REVOKE UPDATE, DELETE, TRUNCATE
  ON awcms_hr_attendance_location_evidence FROM awcms_app;

CREATE TRIGGER awcms_hr_attendance_location_evidence_no_update
  BEFORE UPDATE ON awcms_hr_attendance_location_evidence
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

CREATE OR REPLACE FUNCTION awcms_hr_guard_location_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ev_kind text;
  ev_source text;
  ev_employment uuid;
  ev_office uuid;
  fence_office uuid;
  fence_deleted timestamptz;
  fence_found boolean;
  tenant_on boolean;
BEGIN
  NEW.evaluated_at := clock_timestamp();

  -- Default-deny at the data: while the tenant's switch is off (or was never
  -- written) no evidence row can exist.
  SELECT s.enabled INTO tenant_on
    FROM awcms_hr_geolocation_settings s
   WHERE s.tenant_id = NEW.tenant_id;

  IF tenant_on IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'awcms_hr: HR_GEO_DISABLED' USING ERRCODE = '55000';
  END IF;

  SELECT ev.kind, ev.source, ev.employment_id, ev.office_id
    INTO ev_kind, ev_source, ev_employment, ev_office
    FROM awcms_hr_attendance_events ev
   WHERE ev.tenant_id = NEW.tenant_id AND ev.id = NEW.event_id;

  -- Only the employee's own clock-in / clock-out (a kiosk is a place, not a
  -- person; a break is not an attendance fact).
  IF ev_kind IS NULL OR ev_kind NOT IN ('clock_in', 'clock_out')
     OR ev_source IS DISTINCT FROM 'self' THEN
    RAISE EXCEPTION 'awcms_hr: HR_GEO_EVENT_NOT_ELIGIBLE' USING ERRCODE = '23514';
  END IF;

  NEW.employment_id := ev_employment;

  -- A verdict names a geofence only if that fence is LIVE and belongs to the
  -- office the check-in was for: the event's own office, else the employment's
  -- current one (the same fallback the application uses).
  IF NEW.geofence_id IS NOT NULL THEN
    IF ev_office IS NULL THEN
      SELECT t.office_id INTO ev_office
        FROM awcms_hr_employment_terms t
       WHERE t.tenant_id = NEW.tenant_id AND t.employment_id = ev_employment
         AND t.effective_to IS NULL;
    END IF;

    SELECT g.office_id, g.deleted_at, true
      INTO fence_office, fence_deleted, fence_found
      FROM awcms_hr_geofences g
     WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.geofence_id;

    IF fence_found IS NOT TRUE OR fence_deleted IS NOT NULL
       OR ev_office IS NULL OR fence_office IS DISTINCT FROM ev_office THEN
      RAISE EXCEPTION 'awcms_hr: HR_GEO_FENCE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_attendance_location_evidence_guard
  BEFORE INSERT ON awcms_hr_attendance_location_evidence
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_location_evidence();

-- The retention engine (`data-lifecycle:archive-purge`, generic hard_delete) runs
-- as awcms_worker: candidate selection + delete, nothing else.
-- Column-scoped SELECT: the engine's candidate selection and its delete
-- subquery read only the id, the tenant and the cursor, never a verdict.
GRANT SELECT (id, tenant_id, evaluated_at) ON awcms_hr_attendance_location_evidence TO awcms_worker;
GRANT DELETE ON awcms_hr_attendance_location_evidence TO awcms_worker;

-- 5b. Geofence guards: a cap per office, and the last fence of an enabled tenant ----
-- At most 10 LIVE geofences per office (a bounded evaluation, and a defence
-- against a configuration used to blanket a whole city). Serialised per office.
-- A tenant whose switch is ON cannot soft-delete its last live geofence (the
-- settings row is read FOR SHARE, so a concurrent disable/enable serialises).
CREATE OR REPLACE FUNCTION awcms_hr_guard_geofence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  live_in_office integer;
  tenant_on boolean;
  others integer;
BEGIN
  IF NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.deleted_at IS NOT NULL
          OR OLD.office_id IS DISTINCT FROM NEW.office_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('hr_geofence_office:' || NEW.office_id::text));

    SELECT count(*)::integer INTO live_in_office
      FROM awcms_hr_geofences g
     WHERE g.tenant_id = NEW.tenant_id AND g.office_id = NEW.office_id
       AND g.deleted_at IS NULL AND g.id <> NEW.id;

    IF live_in_office >= 10 THEN
      RAISE EXCEPTION 'awcms_hr: HR_GEO_OFFICE_CAP' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT s.enabled INTO tenant_on
      FROM awcms_hr_geolocation_settings s
     WHERE s.tenant_id = NEW.tenant_id
       FOR SHARE;

    IF tenant_on IS TRUE THEN
      SELECT count(*)::integer INTO others
        FROM awcms_hr_geofences g
       WHERE g.tenant_id = NEW.tenant_id AND g.deleted_at IS NULL AND g.id <> NEW.id;

      IF others = 0 THEN
        RAISE EXCEPTION 'awcms_hr: HR_GEO_LAST_FENCE' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_geofences_guard
  BEFORE INSERT OR UPDATE ON awcms_hr_geofences
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_geofence();

-- The owner role is never handed the configure permission by a blanket grant
-- (src/modules/_shared/owner-grant-exclusions.ts). This is the data-level wall:
-- no INSERT into awcms_role_permissions may attach it to a SYSTEM `owner` role,
-- whatever path wrote it. A person receives it through an explicit assignment
-- to another role.
CREATE OR REPLACE FUNCTION awcms_guard_owner_excluded_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  is_owner boolean;
  excluded boolean;
BEGIN
  SELECT (r.is_system AND r.role_code = 'owner') INTO is_owner
    FROM awcms_roles r
   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.role_id;

  IF is_owner IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT (p.module_key || '.' || p.activity_code || '.' || p.action) IN (
           'hr_workforce.geolocation_evidence.configure')
    INTO excluded
    FROM awcms_permissions p
   WHERE p.id = NEW.permission_id;

  IF excluded IS TRUE THEN
    RAISE EXCEPTION 'awcms: OWNER_GRANT_EXCLUDED' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_role_permissions_owner_exclusion
  BEFORE INSERT ON awcms_role_permissions
  FOR EACH ROW EXECUTE FUNCTION awcms_guard_owner_excluded_permission();

-- Immediate erasure for ONE employment, for the day counsel decides an erasure
-- request must not wait for the retention bound (ADR-0138 section 7). It is NOT
-- wired to the subject-request executor (ADR-0142 allows only
-- `retain_under_obligation` for an indirect subject path, and the executor runs
-- as the request role, which has no DELETE here): an operator calls it as
-- `awcms_worker`, inside the tenant's transaction, and records the act. Owned by
-- a NOLOGIN role holding DELETE and a two-column SELECT on this table only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_hr_geo_evidence_eraser') THEN
    CREATE ROLE awcms_hr_geo_evidence_eraser NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_hr_geo_evidence_eraser NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_hr_geo_evidence_eraser;
GRANT SELECT (tenant_id, employment_id) ON awcms_hr_attendance_location_evidence TO awcms_hr_geo_evidence_eraser;
GRANT DELETE ON awcms_hr_attendance_location_evidence TO awcms_hr_geo_evidence_eraser;

CREATE OR REPLACE FUNCTION awcms_hr_erase_location_evidence(
  p_tenant_id uuid,
  p_employment_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM awcms_hr_attendance_location_evidence AS x
   WHERE x.tenant_id = p_tenant_id AND x.employment_id = p_employment_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION awcms_hr_erase_location_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_erase_location_evidence(uuid, uuid) TO awcms_worker;
ALTER FUNCTION awcms_hr_erase_location_evidence(uuid, uuid) OWNER TO awcms_hr_geo_evidence_eraser;

COMMENT ON FUNCTION awcms_hr_erase_location_evidence(uuid, uuid) IS
  '#970 / ADR-0138 section 7. Deletes every location-evidence verdict of ONE employment in ONE tenant and returns the count. Not reachable from the request role or the subject-request executor; EXECUTE is granted to awcms_worker only, for an operator-run erasure after counsel decides. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE, NOBYPASSRLS owner) plus p_tenant_id.';

-- 6. Count-only retention backlog for the four non-purged tables --------------------
-- Same pattern as sql/303: the worker may not read HR rows, so the dry-run planner
-- calls a SECURITY DEFINER function that returns ONE integer. The function is
-- REPLACED (CREATE OR REPLACE), so the three branches sql/303 gave it are kept.
GRANT SELECT (tenant_id, created_at) ON awcms_hr_geofences TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_hr_geolocation_notices TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_hr_geolocation_settings TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, acknowledged_at) ON awcms_hr_geolocation_notice_acknowledgements TO awcms_hr_workforce_lifecycle_counter;

CREATE OR REPLACE FUNCTION awcms_hr_workforce_lifecycle_eligible_count(
  p_table text,
  p_tenant_id uuid,
  p_cutoff timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_table = 'awcms_hr_employment_terms' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_employment_terms AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_shift_assignments' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_shift_assignments AS x
    WHERE x.tenant_id = p_tenant_id AND x.starts_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_shift_templates' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_shift_templates AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_geofences' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_geofences AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_geolocation_notices' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_geolocation_notices AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_geolocation_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_geolocation_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_geolocation_notice_acknowledgements' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_geolocation_notice_acknowledgements AS x
    WHERE x.tenant_id = p_tenant_id AND x.acknowledged_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_hr_workforce_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) IS
  '#1042 / #970. Count-only retention-backlog read for the hr_workforce lifecycle descriptors the worker may not read: how many rows of the named table (one of this module''s, anything else raises 22023) belong to the tenant and are older than the cutoff. Returns one integer, never a row. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE with a NOBYPASSRLS owner) plus p_tenant_id; it adds no capability beyond the worker''s existing per-tenant iteration and is not a boundary against the worker. The owner role holds column-level SELECT on (tenant_id, cursor column) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_hr_workforce_lifecycle_counter;

-- 7. Permissions -----------------------------------------------------------------------
-- Verbatim match to `src/modules/hr-workforce/module.ts`.
--
--   * `attendance_evidence.read`: the verdict rows. HR and, within their scope, a
--     supervisor hold it by ASSIGNMENT; an employee reads their OWN rows through
--     an `ownershipGrant` (widens a read only, ADR-0063).
--   * `geolocation_evidence.configure`: the switch, ceiling, notice version and
--     geofences. HIGH-RISK. NOT granted to the tenant `owner` role by the
--     blanket new-tenant grant nor by the backfill job
--     (`OWNER_GRANT_EXCLUDED_PERMISSION_KEYS`): a person receives it only by an
--     explicit assignment (ADR-0138 section 3). It stays `scope = 'tenant'`: the
--     action is inside one tenant.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_workforce', 'attendance_evidence', 'read',
   'Read the location-evidence verdicts of any employment; an employee reads their own without this'),
  ('hr_workforce', 'geolocation_evidence', 'configure',
   'Switch geolocation attendance evidence on or off and manage its geofences, notice version and accuracy ceiling — high-risk; not granted by default')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

COMMENT ON TABLE awcms_hr_attendance_location_evidence IS
  'Issue #970 / ADR-0138 — RESTRICTED personal data. One VERDICT per self clock-in/out while the tenant switch is on: inside/outside/not_provided, coarse distance and accuracy bands, the geofence, the rule version and the database time. NO coordinate, raw accuracy, altitude, speed, heading, address, device or network id, photo or biometric, anywhere. Append-only for awcms_app; purged by the retention engine (30/90/180 days, hard delete, legal hold overrides). Never a column of the attendance event.';
COMMENT ON TABLE awcms_hr_geofences IS
  'Issue #970 / ADR-0138 — a tenant-defined work-site circle or small polygon attached to an office. A place of business, not personal data. Soft delete only.';
COMMENT ON TABLE awcms_hr_geolocation_settings IS
  'Issue #970 / ADR-0138 — the per-tenant geolocation evidence switch. enabled is FALSE for every tenant and is never set by a migration, seed or environment variable; enabling needs a DPIA reference + date, a published notice and a live geofence.';
COMMENT ON TABLE awcms_hr_geolocation_notices IS
  'Issue #970 / ADR-0138 — append-only published notice versions (tenant-authored text per locale).';
COMMENT ON TABLE awcms_hr_geolocation_notice_acknowledgements IS
  'Issue #970 / ADR-0138 — evidence of NOTICE (employment, notice version, time), not a consent record. Append-only; written only by the employee''s own linked login.';
