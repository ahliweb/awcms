-- crm_follow_up -- rule-versioned STAFF follow-up tasks keyed by lead events
-- (Issue #1165, ADR-0159, extending ADR-0153 N5).
--
-- ## What this module owns, and what it never owns
--
-- Follow-up RULES (tenant data) with IMMUTABLE revisions, the TASKS a rule
-- creates for a member of staff when a `crm_leads` event matches it, the
-- append-only ACTION history of every task, the append-only STOP SIGNALS of a
-- lead, and the staff NOTIFICATION intents a task owes. It owns NO lead copy
-- (ADR-0153: "key tasks by lead id; do not store a lead copy"): `lead_id` is an
-- opaque reference with no foreign key, and no name, contact point, stage name
-- or note of the prospect is ever stored here. It sends NOTHING to the lead
-- (ADR-0159 section 2): a notification goes to a tenant user, through the
-- existing e-mail outbox, in a fixed category (sql/371).
--
-- ## Stop signals win (ADR-0159 section 5)
--
-- A task is never inserted for a lead that has a stop signal: the application
-- serialises task creation and stop recording on a per-(tenant, lead)
-- transaction advisory lock, and the BEFORE INSERT trigger below refuses the
-- insert whatever the application does.
--
-- ## Idempotency (ADR-0159 section 4)
--
-- One task per (tenant, rule, source event): a replayed or redelivered lead
-- event yields the same single task. One notification per (task, kind,
-- recipient).
--
-- ## RLS / GRANT
--
-- Every table is FORCE ROW LEVEL SECURITY with the standard tenant_isolation
-- policy and composite (tenant_id, id) foreign keys. `awcms_app` holds no
-- DELETE anywhere and no UPDATE on the immutable revisions or the append-only
-- actions and stop signals. `awcms_worker` (the domain-event consumer and
-- `bun run crm-follow-up:dispatch`) reads the configuration, creates and
-- settles tasks and notifications, and appends actions and stop signals; it
-- never writes a rule or a revision and never deletes.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- ---------------------------------------------------------------------------
-- Tenant switch. A tenant that never wrote a row is OFF.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  enabled boolean NOT NULL DEFAULT false,
  -- The per-recipient pacing cap: at most this many follow-up notices handed
  -- to the e-mail outbox per recipient in any rolling hour; the rest wait.
  max_notices_per_recipient_hour integer NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_crm_follow_up_settings_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_settings_cap_check
    CHECK (max_notices_per_recipient_hour BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_settings_updated_by_idx
  ON awcms_crm_follow_up_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Rules and their immutable revisions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_revision_number integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_crm_follow_up_rules_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rules_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rules_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rules_code_check
    CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  CONSTRAINT awcms_crm_follow_up_rules_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT awcms_crm_follow_up_rules_status_check
    CHECK (status IN ('active', 'archived')),
  CONSTRAINT awcms_crm_follow_up_rules_revision_number_check
    CHECK (current_revision_number >= 0),
  CONSTRAINT awcms_crm_follow_up_rules_version_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_follow_up_rules_code_key
  ON awcms_crm_follow_up_rules (tenant_id, code);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_rules_created_by_idx
  ON awcms_crm_follow_up_rules (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_rules_updated_by_idx
  ON awcms_crm_follow_up_rules (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_rule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  rule_id uuid NOT NULL,
  revision_number integer NOT NULL,
  -- The trigger: a closed list (ADR-0159 section 3), with optional filters.
  trigger_kind text NOT NULL,
  -- Opaque crm_leads ids/keys, never joined: this module stores no lead copy.
  pipeline_id uuid,
  stage_category text,
  stage_key text,
  task_title text NOT NULL,
  -- Offsets in WORKING minutes over the calendar below.
  due_after_minutes integer NOT NULL,
  escalate_after_minutes integer,
  escalation_tenant_user_id uuid,
  assignee_mode text NOT NULL,
  fixed_assignee_tenant_user_id uuid,
  notify_on_assign boolean NOT NULL DEFAULT false,
  notify_on_due boolean NOT NULL DEFAULT false,
  max_open_per_lead integer NOT NULL DEFAULT 1,
  -- The working calendar: an IANA zone (validated by the application against
  -- the runtime's zone database), ISO weekdays as a bitmask (bit 0 = Monday
  -- ... bit 6 = Sunday), a daily window in minutes after local midnight and a
  -- bounded list of local holiday dates.
  time_zone text NOT NULL,
  working_days integer NOT NULL,
  work_start_minute integer NOT NULL,
  work_end_minute integer NOT NULL,
  holidays text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- SHA-256 hex of the canonical definition: proves a published revision
  -- unchanged and refuses an identical republish.
  definition_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  CONSTRAINT awcms_crm_follow_up_rule_revisions_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_number_key
    UNIQUE (tenant_id, rule_id, revision_number),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_rule_fk
    FOREIGN KEY (tenant_id, rule_id)
    REFERENCES awcms_crm_follow_up_rules (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_published_by_fk
    FOREIGN KEY (tenant_id, published_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_escalation_user_fk
    FOREIGN KEY (tenant_id, escalation_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_fixed_assignee_fk
    FOREIGN KEY (tenant_id, fixed_assignee_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_number_check
    CHECK (revision_number >= 1),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_trigger_check
    CHECK (trigger_kind IN ('lead_created', 'stage_entered', 'lead_assigned')),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_stage_category_check
    CHECK (
      stage_category IS NULL
      OR stage_category IN ('new', 'working', 'qualified', 'converted',
                            'lost', 'disqualified')
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_stage_key_check
    CHECK (stage_key IS NULL OR stage_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_stage_filter_check
    CHECK (
      trigger_kind <> 'lead_assigned'
      OR (stage_category IS NULL AND stage_key IS NULL)
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_title_check
    CHECK (btrim(task_title) <> '' AND char_length(task_title) <= 120),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_due_check
    CHECK (due_after_minutes BETWEEN 0 AND 43200),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_escalate_check
    CHECK (
      (escalate_after_minutes IS NULL AND escalation_tenant_user_id IS NULL)
      OR escalate_after_minutes BETWEEN 1 AND 43200
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_assignee_check
    CHECK (
      (assignee_mode = 'lead_owner' AND fixed_assignee_tenant_user_id IS NULL)
      OR (assignee_mode = 'fixed_user'
          AND fixed_assignee_tenant_user_id IS NOT NULL)
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_cap_check
    CHECK (max_open_per_lead BETWEEN 1 AND 5),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_time_zone_check
    CHECK (time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_days_check
    CHECK (working_days BETWEEN 1 AND 127),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_window_check
    CHECK (
      work_start_minute BETWEEN 0 AND 1439
      AND work_end_minute BETWEEN 1 AND 1440
      AND work_start_minute < work_end_minute
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_holidays_check
    CHECK (
      cardinality(holidays) <= 366
      AND array_to_string(holidays, ',') ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}(,[0-9]{4}-[0-9]{2}-[0-9]{2})*)?$'
    ),
  CONSTRAINT awcms_crm_follow_up_rule_revisions_hash_check
    CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_rule_revisions_published_by_idx
  ON awcms_crm_follow_up_rule_revisions (tenant_id, published_by)
  WHERE published_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_rule_revisions_escalation_user_idx
  ON awcms_crm_follow_up_rule_revisions (tenant_id, escalation_tenant_user_id)
  WHERE escalation_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_rule_revisions_fixed_assignee_idx
  ON awcms_crm_follow_up_rule_revisions (tenant_id, fixed_assignee_tenant_user_id)
  WHERE fixed_assignee_tenant_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tasks and their append-only actions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Opaque crm_leads lead id. No foreign key on purpose (no lead copy, and the
  -- module must keep working when crm_leads is off; ADR-0153 L12).
  lead_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  rule_revision_id uuid NOT NULL,
  -- The domain event that created the task: the idempotency key.
  source_event_id uuid NOT NULL,
  trigger_kind text NOT NULL,
  -- Copied from the revision at creation: a tenant-authored label, not
  -- personal data.
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  assignee_mode text NOT NULL,
  assignee_tenant_user_id uuid,
  due_at timestamptz NOT NULL,
  escalate_at timestamptz,
  escalated_at timestamptz,
  outcome text,
  cancel_reason text,
  closed_at timestamptz,
  closed_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_crm_follow_up_tasks_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_tasks_source_key
    UNIQUE (tenant_id, rule_id, source_event_id),
  CONSTRAINT awcms_crm_follow_up_tasks_rule_fk
    FOREIGN KEY (tenant_id, rule_id)
    REFERENCES awcms_crm_follow_up_rules (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_tasks_revision_fk
    FOREIGN KEY (tenant_id, rule_revision_id)
    REFERENCES awcms_crm_follow_up_rule_revisions (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_tasks_assignee_fk
    FOREIGN KEY (tenant_id, assignee_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_tasks_closed_by_fk
    FOREIGN KEY (tenant_id, closed_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_tasks_trigger_check
    CHECK (trigger_kind IN ('lead_created', 'stage_entered', 'lead_assigned')),
  CONSTRAINT awcms_crm_follow_up_tasks_title_check
    CHECK (btrim(title) <> '' AND char_length(title) <= 120),
  CONSTRAINT awcms_crm_follow_up_tasks_status_check
    CHECK (status IN ('open', 'escalated', 'completed', 'cancelled')),
  CONSTRAINT awcms_crm_follow_up_tasks_assignee_mode_check
    CHECK (assignee_mode IN ('lead_owner', 'fixed_user')),
  CONSTRAINT awcms_crm_follow_up_tasks_outcome_check
    CHECK (
      (status = 'completed'
       AND outcome IN ('reached', 'no_answer', 'rescheduled',
                       'not_interested', 'other'))
      OR (status <> 'completed' AND outcome IS NULL)
    ),
  CONSTRAINT awcms_crm_follow_up_tasks_cancel_reason_check
    CHECK (
      (status = 'cancelled'
       AND cancel_reason IN ('manual_cancel', 'stop_converted', 'stop_lost',
                             'stop_merged', 'stop_reply_received',
                             'stop_consent_withdrawn', 'stop_sender_blocked',
                             'stop_manual'))
      OR (status <> 'cancelled' AND cancel_reason IS NULL)
    ),
  CONSTRAINT awcms_crm_follow_up_tasks_closed_check
    CHECK (
      (status IN ('completed', 'cancelled')) = (closed_at IS NOT NULL)
    ),
  CONSTRAINT awcms_crm_follow_up_tasks_escalated_check
    CHECK (status <> 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT awcms_crm_follow_up_tasks_version_check CHECK (version >= 1)
);

-- The open work of a lead (stop cancellation, the per-lead cap, reassignment).
CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_lead_open_idx
  ON awcms_crm_follow_up_tasks (tenant_id, lead_id, rule_id)
  WHERE status IN ('open', 'escalated');

-- The queue and the overdue view: keyset on (due_at, id).
CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_queue_idx
  ON awcms_crm_follow_up_tasks (tenant_id, status, due_at, id);

-- "My work": an assignee's open tasks.
CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_assignee_idx
  ON awcms_crm_follow_up_tasks (tenant_id, assignee_tenant_user_id, due_at, id)
  WHERE assignee_tenant_user_id IS NOT NULL;

-- The escalation sweep.
CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_escalation_due_idx
  ON awcms_crm_follow_up_tasks (tenant_id, escalate_at)
  WHERE status = 'open' AND escalate_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_revision_idx
  ON awcms_crm_follow_up_tasks (tenant_id, rule_revision_id);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_tasks_closed_by_idx
  ON awcms_crm_follow_up_tasks (tenant_id, closed_by)
  WHERE closed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_task_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  task_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  -- NULL for the system (the consumer or the job).
  actor_tenant_user_id uuid,
  assignee_tenant_user_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_crm_follow_up_task_actions_task_fk
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES awcms_crm_follow_up_tasks (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_task_actions_actor_fk
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_task_actions_assignee_fk
    FOREIGN KEY (tenant_id, assignee_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_task_actions_action_check
    CHECK (action IN ('created', 'reassigned', 'escalated', 'completed',
                      'cancelled')),
  CONSTRAINT awcms_crm_follow_up_task_actions_status_check
    CHECK (
      (from_status IS NULL OR from_status IN ('open', 'escalated'))
      AND to_status IN ('open', 'escalated', 'completed', 'cancelled')
    ),
  CONSTRAINT awcms_crm_follow_up_task_actions_reason_check
    CHECK (
      reason IS NULL
      OR reason IN ('rule_trigger', 'lead_owner_changed', 'assignee_inactive',
                    'overdue', 'reached', 'no_answer', 'rescheduled',
                    'not_interested', 'other', 'manual_cancel',
                    'stop_converted', 'stop_lost', 'stop_merged',
                    'stop_reply_received', 'stop_consent_withdrawn',
                    'stop_sender_blocked', 'stop_manual')
    )
);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_task_actions_task_idx
  ON awcms_crm_follow_up_task_actions (tenant_id, task_id, occurred_at);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_task_actions_actor_idx
  ON awcms_crm_follow_up_task_actions (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_task_actions_assignee_idx
  ON awcms_crm_follow_up_task_actions (tenant_id, assignee_tenant_user_id)
  WHERE assignee_tenant_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Stop signals: append-only facts about a lead (ADR-0159 section 5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_stop_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  source_event_id uuid,
  recorded_by uuid,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_crm_follow_up_stop_signals_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_stop_signals_kind_check
    CHECK (kind IN ('converted', 'lost', 'merged', 'reply_received',
                    'consent_withdrawn', 'sender_blocked', 'manual')),
  CONSTRAINT awcms_crm_follow_up_stop_signals_source_check
    CHECK (
      (source = 'lead_event' AND source_event_id IS NOT NULL
       AND recorded_by IS NULL
       AND kind IN ('converted', 'lost', 'merged'))
      OR (source = 'staff' AND source_event_id IS NULL
          AND recorded_by IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_follow_up_stop_signals_event_key
  ON awcms_crm_follow_up_stop_signals (tenant_id, source_event_id, kind)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_stop_signals_lead_idx
  ON awcms_crm_follow_up_stop_signals (tenant_id, lead_id);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_stop_signals_recorded_by_idx
  ON awcms_crm_follow_up_stop_signals (tenant_id, recorded_by)
  WHERE recorded_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Staff notification intents, settled by `bun run crm-follow-up:dispatch`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_follow_up_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  task_id uuid NOT NULL,
  kind text NOT NULL,
  recipient_tenant_user_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  settle_reason text,
  deferrals integer NOT NULL DEFAULT 0,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_crm_follow_up_notifications_once_key
    UNIQUE (tenant_id, task_id, kind, recipient_tenant_user_id),
  CONSTRAINT awcms_crm_follow_up_notifications_task_fk
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES awcms_crm_follow_up_tasks (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_notifications_recipient_fk
    FOREIGN KEY (tenant_id, recipient_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_follow_up_notifications_kind_check
    CHECK (kind IN ('assigned', 'due', 'escalated')),
  CONSTRAINT awcms_crm_follow_up_notifications_status_check
    CHECK (status IN ('pending', 'enqueued', 'cancelled', 'suppressed')),
  CONSTRAINT awcms_crm_follow_up_notifications_settled_check
    CHECK ((status = 'pending') = (settled_at IS NULL)),
  CONSTRAINT awcms_crm_follow_up_notifications_reason_check
    CHECK (
      (status IN ('pending', 'enqueued') AND settle_reason IS NULL)
      OR (status IN ('cancelled', 'suppressed')
          AND settle_reason IN ('task_closed', 'lead_stopped',
                                'recipient_inactive', 'recipient_changed'))
    ),
  CONSTRAINT awcms_crm_follow_up_notifications_deferrals_check
    CHECK (deferrals BETWEEN 0 AND 1000)
);

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_notifications_due_idx
  ON awcms_crm_follow_up_notifications (tenant_id, scheduled_at, id)
  WHERE status = 'pending';

-- The rolling-hour pacing count per recipient.
CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_notifications_pacing_idx
  ON awcms_crm_follow_up_notifications (tenant_id, recipient_tenant_user_id, settled_at)
  WHERE status = 'enqueued';

CREATE INDEX IF NOT EXISTS awcms_crm_follow_up_notifications_recipient_idx
  ON awcms_crm_follow_up_notifications (tenant_id, recipient_tenant_user_id);

-- ---------------------------------------------------------------------------
-- Integrity guards (bind the owner too, unlike the REVOKEs below).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_crm_follow_up_immutable_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never changed or removed', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER awcms_crm_follow_up_rule_revisions_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_follow_up_rule_revisions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_immutable_row_guard();

CREATE TRIGGER awcms_crm_follow_up_task_actions_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_follow_up_task_actions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_immutable_row_guard();

CREATE TRIGGER awcms_crm_follow_up_stop_signals_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_follow_up_stop_signals
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_immutable_row_guard();

-- A task is born open, and never for a stopped lead (the stop wins).
CREATE OR REPLACE FUNCTION awcms_crm_follow_up_task_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status <> 'open' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: a task is created open at version 1'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM awcms_crm_follow_up_stop_signals s
     WHERE s.tenant_id = NEW.tenant_id AND s.lead_id = NEW.lead_id
  ) THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: CRM_FOLLOW_UP_LEAD_STOPPED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_follow_up_tasks_insert_guard
  BEFORE INSERT ON awcms_crm_follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_task_insert_guard();

-- A task's identity never changes; its status moves only along
-- open -> escalated | completed | cancelled and escalated -> completed |
-- cancelled; a closed task is frozen; every change bumps the version by one.
CREATE OR REPLACE FUNCTION awcms_crm_follow_up_task_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.rule_revision_id IS DISTINCT FROM OLD.rule_revision_id
     OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
     OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.assignee_mode IS DISTINCT FROM OLD.assignee_mode
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.escalate_at IS DISTINCT FROM OLD.escalate_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: the identity of a task is immutable (%)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: a closed task is frozen (%)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'open'
        AND NEW.status IN ('escalated', 'completed', 'cancelled'))
       OR (OLD.status = 'escalated'
           AND NEW.status IN ('completed', 'cancelled'))
     ) THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: transition % -> % is not allowed',
      OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: a task change must bump its version by one'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_follow_up_tasks_update_guard
  BEFORE UPDATE ON awcms_crm_follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_task_update_guard();

CREATE TRIGGER awcms_crm_follow_up_tasks_no_delete
  BEFORE DELETE ON awcms_crm_follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_immutable_row_guard();

-- A notification's identity never changes, and once settled it is frozen.
CREATE OR REPLACE FUNCTION awcms_crm_follow_up_notification_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.recipient_tenant_user_id IS DISTINCT FROM OLD.recipient_tenant_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: the identity of a notification is immutable (%)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'awcms_crm_follow_up: a settled notification is frozen (%)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_follow_up_notifications_update_guard
  BEFORE UPDATE ON awcms_crm_follow_up_notifications
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_notification_update_guard();

CREATE TRIGGER awcms_crm_follow_up_notifications_no_delete
  BEFORE DELETE ON awcms_crm_follow_up_notifications
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_follow_up_immutable_row_guard();

-- ---------------------------------------------------------------------------
-- RLS FORCE on every table, standard tenant isolation.
-- ---------------------------------------------------------------------------
ALTER TABLE awcms_crm_follow_up_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_settings_tenant_isolation
  ON awcms_crm_follow_up_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_rules_tenant_isolation
  ON awcms_crm_follow_up_rules
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_rule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_rule_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_rule_revisions_tenant_isolation
  ON awcms_crm_follow_up_rule_revisions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_tasks_tenant_isolation
  ON awcms_crm_follow_up_tasks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_task_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_task_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_task_actions_tenant_isolation
  ON awcms_crm_follow_up_task_actions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_stop_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_stop_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_stop_signals_tenant_isolation
  ON awcms_crm_follow_up_stop_signals
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE awcms_crm_follow_up_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_follow_up_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_follow_up_notifications_tenant_isolation
  ON awcms_crm_follow_up_notifications
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Grants. awcms_app: no DELETE anywhere, no UPDATE on the immutable and
-- append-only tables. awcms_worker: exactly what the consumer and the dispatch
-- job need, never a rule or a revision write, never a DELETE.
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON awcms_crm_follow_up_settings FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_crm_follow_up_rules FROM awcms_app;
REVOKE DELETE, TRUNCATE, UPDATE ON awcms_crm_follow_up_rule_revisions FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_crm_follow_up_tasks FROM awcms_app;
REVOKE DELETE, TRUNCATE, UPDATE ON awcms_crm_follow_up_task_actions FROM awcms_app;
REVOKE DELETE, TRUNCATE, UPDATE ON awcms_crm_follow_up_stop_signals FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_crm_follow_up_notifications FROM awcms_app;

REVOKE ALL ON awcms_crm_follow_up_settings FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_rules FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_rule_revisions FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_tasks FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_task_actions FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_stop_signals FROM awcms_worker;
REVOKE ALL ON awcms_crm_follow_up_notifications FROM awcms_worker;

GRANT SELECT ON awcms_crm_follow_up_settings TO awcms_worker;
GRANT SELECT ON awcms_crm_follow_up_rules TO awcms_worker;
GRANT SELECT ON awcms_crm_follow_up_rule_revisions TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_crm_follow_up_tasks TO awcms_worker;
GRANT SELECT, INSERT ON awcms_crm_follow_up_task_actions TO awcms_worker;
GRANT SELECT, INSERT ON awcms_crm_follow_up_stop_signals TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_crm_follow_up_notifications TO awcms_worker;

COMMENT ON TABLE awcms_crm_follow_up_tasks IS
  'Issue #1165 / ADR-0159 -- a follow-up task for a member of staff, created by a rule revision when a crm_leads event matched it. Unique per (rule, source event). Carries the opaque lead id only; never a lead copy.';

COMMENT ON TABLE awcms_crm_follow_up_stop_signals IS
  'Issue #1165 / ADR-0159 section 5 -- an append-only stop fact about a lead. A lead with any stop signal gets no new task (trigger) and its open tasks and pending notifications are cancelled.';

COMMENT ON TABLE awcms_crm_follow_up_rule_revisions IS
  'Issue #1165 / ADR-0159 section 3 -- an immutable published revision of a follow-up rule: a closed trigger, offsets in working minutes, the assignee mode and the working calendar.';
