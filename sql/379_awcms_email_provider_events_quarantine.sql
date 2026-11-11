-- `email` — Mailketing webhook intake in ADR-0151 `strict` mode: a quarantine
-- ledger of provider-reported, UNAUTHENTICATED delivery events, and a source
-- marker on the suppression list (Issue #1161, ADR-0151 section 5, ADR-0150
-- I9/N5). Forward-only; `sql/014`, `sql/095`, `sql/318`, `sql/320` and
-- `sql/346` are applied and are NOT edited.
--
-- ## Why a quarantine and not a status write
--
-- Mailketing documents NO way to authenticate a callback (no signature, no
-- secret header, no source-IP list, no event id; re-verified on 2026-11-11
-- against https://api.mailketing.co.id/docs/webhook.html). ADR-0151 section 5
-- therefore admits the endpoint only in `strict` mode until the maintainer
-- answers Q1: no event changes a message status, a suppression, a subscriber or
-- consent. What an event may do is land HERE, labelled `unauthenticated`, bound
-- to a message THIS tenant sent through THIS Mailketing account, where an
-- operator may confirm a bounce or an unsubscribe into the suppression list
-- (an audited human decision, `email.webhook.review`).
--
-- The callback credential is an `awcms_channel_webhook_subscriptions` row of
-- `channel_accounts` (ADR-0148, `sql/318`): an opaque 256-bit token, only its
-- SHA-256 stored, `verification_mode = 'unauthenticated'` (status-class only by
-- that table's own CHECK). It locates the tenant and the account; it is not
-- treated as proof of who sent the request (ADR-0150 N5).
--
-- ## What this table refuses, by CHECK and trigger, for every role
--
--   * `authenticity` is ALWAYS `unauthenticated`. Admitting an authenticated
--     mode is a new migration with the ADR amendment that admits it.
--   * Only `bounce` and `unsubscribe` can be reviewed; `open`, `click` and
--     `delivered` are `informational` counters forever (ADR-0151 section 5:
--     never proof of reading, never used for scoring or customer state).
--     `newsubscriber` is never stored at all (it must never create consent).
--   * A click stores the link's host and a hash, never the URL.
--   * The row is IMMUTABLE except its review, and a review moves only from
--     `pending` to `confirmed` or `dismissed`, once.
--   * `received_at` is the DATABASE clock at insert, whatever a statement asks
--     for: the retention floor below rests on it, so no role can make a fresh
--     row look old (the sql/357 lesson).
--   * Replay and flood are refused by `UNIQUE (tenant_id, dedupe_key)`. The key
--     deliberately leaves the provider timestamp OUT (audit M-2 of PR #1272: a
--     holder of a valid URL could mint rows by varying it): one row per
--     (account, type, our message) for bounce/open/delivered, one per (account,
--     type, recipient hash, UTC day) for click/unsubscribe. A partial unique
--     index keeps at most ONE pending unsubscribe per recipient.
--   * `awcms_app` holds no DELETE, and a BEFORE DELETE trigger refuses, for
--     every role, a row the retention rule would not remove (see below).
--
-- `email_message_id` is a REFERENCE, not a foreign key, on purpose: the queue
-- purge (`email:queue:purge`) deletes terminal messages after their own window,
-- and evidence about a message must not block, or be cascaded by, that purge.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- ---------------------------------------------------------------------------
-- The quarantine ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_email_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The callback credential the request presented, and its Mailketing account.
  subscription_id uuid NOT NULL,
  esp_account_id uuid NOT NULL,
  -- OUR message the event was bound to (see the header: a reference, no FK).
  email_message_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'mailketing',
  event_type text NOT NULL,
  -- How the event was bound to our message: by the provider message id we
  -- stored at acceptance AND the recipient (bounce, open, delivered), or by
  -- the recipient alone for the events Mailketing sends without an id (click,
  -- unsubscribe), and then only to a message this account sent that recipient.
  correlation text NOT NULL,
  provider_message_id text,
  recipient_hash text NOT NULL,
  recipient_masked text NOT NULL,
  bounce_class text,
  status_code text,
  link_host text,
  link_hash text,
  provider_reported_at timestamptz,
  dedupe_key text NOT NULL,
  authenticity text NOT NULL DEFAULT 'unauthenticated',
  review_status text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  suppression_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_email_provider_events_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_email_provider_events_dedupe_key
    UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT awcms_email_provider_events_provider_check
    CHECK (provider = 'mailketing'),
  CONSTRAINT awcms_email_provider_events_event_type_check
    CHECK (event_type IN ('bounce', 'open', 'click', 'unsubscribe', 'delivered')),
  CONSTRAINT awcms_email_provider_events_correlation_check CHECK (
    (correlation = 'provider_message_id'
      AND event_type IN ('bounce', 'open', 'delivered')
      AND provider_message_id IS NOT NULL)
    OR (correlation = 'recipient_only'
      AND event_type IN ('click', 'unsubscribe')
      AND provider_message_id IS NULL)
  ),
  CONSTRAINT awcms_email_provider_events_provider_message_id_check CHECK (
    provider_message_id IS NULL
    OR provider_message_id ~ '^[A-Za-z0-9._:@<>+=/-]{1,128}$'
  ),
  CONSTRAINT awcms_email_provider_events_recipient_hash_check
    CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_email_provider_events_recipient_masked_check
    CHECK (char_length(recipient_masked) BETWEEN 1 AND 254),
  CONSTRAINT awcms_email_provider_events_bounce_class_check CHECK (
    (event_type = 'bounce' AND bounce_class IN ('hard', 'soft', 'unknown'))
    OR (event_type <> 'bounce' AND bounce_class IS NULL)
  ),
  CONSTRAINT awcms_email_provider_events_status_code_check CHECK (
    status_code IS NULL
    OR (event_type = 'bounce' AND status_code ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$')
  ),
  CONSTRAINT awcms_email_provider_events_link_check CHECK (
    (event_type = 'click'
      AND link_host IS NOT NULL
      AND link_host ~ '^[a-z0-9.-]{1,253}$'
      AND link_hash ~ '^[0-9a-f]{64}$')
    OR (event_type <> 'click' AND link_host IS NULL AND link_hash IS NULL)
  ),
  CONSTRAINT awcms_email_provider_events_dedupe_key_check
    CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_email_provider_events_authenticity_check
    CHECK (authenticity = 'unauthenticated'),
  CONSTRAINT awcms_email_provider_events_review_status_check CHECK (
    (event_type IN ('bounce', 'unsubscribe')
      AND review_status IN ('pending', 'confirmed', 'dismissed'))
    OR (event_type IN ('open', 'click', 'delivered')
      AND review_status = 'informational')
  ),
  CONSTRAINT awcms_email_provider_events_review_stamp_check CHECK (
    (review_status IN ('pending', 'informational')
      AND reviewed_by IS NULL AND reviewed_at IS NULL AND suppression_id IS NULL)
    OR (review_status = 'dismissed'
      AND reviewed_at IS NOT NULL AND suppression_id IS NULL)
    OR (review_status = 'confirmed' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT awcms_email_provider_events_subscription_fk
    FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES awcms_channel_webhook_subscriptions (tenant_id, id),
  CONSTRAINT awcms_email_provider_events_esp_account_fk
    FOREIGN KEY (tenant_id, esp_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_email_provider_events_reviewed_by_fk
    FOREIGN KEY (tenant_id, reviewed_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- The review queue and the retention purge: newest pending first, oldest first.
CREATE INDEX IF NOT EXISTS awcms_email_provider_events_review_idx
  ON awcms_email_provider_events (tenant_id, review_status, received_at);

CREATE INDEX IF NOT EXISTS awcms_email_provider_events_retention_idx
  ON awcms_email_provider_events (tenant_id, received_at);

-- The provider-reported projection of one message, and the soft-bounce count
-- of one recipient.
CREATE INDEX IF NOT EXISTS awcms_email_provider_events_message_idx
  ON awcms_email_provider_events (tenant_id, email_message_id);

CREATE INDEX IF NOT EXISTS awcms_email_provider_events_recipient_idx
  ON awcms_email_provider_events (tenant_id, recipient_hash, event_type, received_at);

-- At most ONE pending unsubscribe per recipient (audit M-2 of PR #1272): a
-- repeated report for a person already awaiting review adds nothing to decide,
-- so it must not add a row either (the intake's ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_email_provider_events_pending_unsubscribe_key
  ON awcms_email_provider_events (tenant_id, recipient_hash)
  WHERE event_type = 'unsubscribe' AND review_status = 'pending';

-- `db:fk-index:check`: one index per composite foreign key.
CREATE INDEX IF NOT EXISTS awcms_email_provider_events_subscription_idx
  ON awcms_email_provider_events (tenant_id, subscription_id);

CREATE INDEX IF NOT EXISTS awcms_email_provider_events_esp_account_idx
  ON awcms_email_provider_events (tenant_id, esp_account_id);

CREATE INDEX IF NOT EXISTS awcms_email_provider_events_reviewed_by_idx
  ON awcms_email_provider_events (tenant_id, reviewed_by)
  WHERE reviewed_by IS NOT NULL;

COMMENT ON TABLE awcms_email_provider_events IS
  'Issue #1161 / ADR-0151 section 5 (strict mode) - provider-reported, UNAUTHENTICATED Mailketing delivery events bound to a message this tenant sent through this account. Changes nothing by itself: an operator may confirm a bounce or unsubscribe into the suppression list. Opens, clicks and delivered are informational counters, never proof. Immutable except a one-time review.';

ALTER TABLE awcms_email_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_provider_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_provider_events_tenant_isolation
  ON awcms_email_provider_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Database clock at insert; immutable except the one-time review.
CREATE OR REPLACE FUNCTION awcms_email_provider_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.received_at := now();
    NEW.authenticity := 'unauthenticated';

    IF NEW.review_status NOT IN ('pending', 'informational') THEN
      RAISE EXCEPTION 'a provider event is recorded unreviewed'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.esp_account_id IS DISTINCT FROM OLD.esp_account_id
     OR NEW.email_message_id IS DISTINCT FROM OLD.email_message_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.correlation IS DISTINCT FROM OLD.correlation
     OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
     OR NEW.recipient_hash IS DISTINCT FROM OLD.recipient_hash
     OR NEW.recipient_masked IS DISTINCT FROM OLD.recipient_masked
     OR NEW.bounce_class IS DISTINCT FROM OLD.bounce_class
     OR NEW.status_code IS DISTINCT FROM OLD.status_code
     OR NEW.link_host IS DISTINCT FROM OLD.link_host
     OR NEW.link_hash IS DISTINCT FROM OLD.link_hash
     OR NEW.provider_reported_at IS DISTINCT FROM OLD.provider_reported_at
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.authenticity IS DISTINCT FROM OLD.authenticity
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'a provider event is immutable except its review'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
    IF OLD.review_status <> 'pending'
       OR NEW.review_status NOT IN ('confirmed', 'dismissed') THEN
      RAISE EXCEPTION 'a provider event is reviewed once, from pending'
        USING ERRCODE = '23514';
    END IF;

    NEW.reviewed_at := now();
  ELSIF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.suppression_id IS DISTINCT FROM OLD.suppression_id THEN
    RAISE EXCEPTION 'a provider event review is final'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_email_provider_events_guard
  BEFORE INSERT OR UPDATE ON awcms_email_provider_events
  FOR EACH ROW
  EXECUTE FUNCTION awcms_email_provider_events_guard();

-- Retention (`email:queue:purge`, delegated adopter, runs as `awcms_worker`).
-- The DATABASE floor: the worker cannot delete a row younger than 30 days
-- (`retentionMinDays`), nor a PENDING row younger than 365 days (an unreviewed
-- unsubscribe is a person's request and outlives the ordinary window). Both
-- rest on `received_at`, which only the trigger above writes.
--
-- Two layers (audit L-1 of PR #1272): the runtime role has NO delete at all
-- (nothing in the request path deletes evidence), and a BEFORE DELETE trigger
-- refuses, for EVERY role, a row the retention rule would not remove. The
-- restrictive policy below filters the worker's purge silently; the trigger is
-- what still holds on a single-role deployment where the purge connects as the
-- same role as the app, or as an owner the policy does not bind.
REVOKE DELETE ON awcms_email_provider_events FROM awcms_app;
GRANT SELECT, DELETE ON awcms_email_provider_events TO awcms_worker;

CREATE OR REPLACE FUNCTION awcms_email_provider_events_delete_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.received_at >= now() - interval '30 days'
     OR (OLD.review_status = 'pending'
         AND OLD.received_at >= now() - interval '365 days') THEN
    RAISE EXCEPTION 'a provider event is deleted only by retention, past its window'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE TRIGGER awcms_email_provider_events_delete_floor
  BEFORE DELETE ON awcms_email_provider_events
  FOR EACH ROW
  EXECUTE FUNCTION awcms_email_provider_events_delete_floor();

DROP POLICY IF EXISTS awcms_email_provider_events_worker_retention_floor
  ON awcms_email_provider_events;

CREATE POLICY awcms_email_provider_events_worker_retention_floor
  ON awcms_email_provider_events
  AS RESTRICTIVE
  FOR DELETE
  TO awcms_worker
  USING (
    received_at < now() - interval '30 days'
    AND (review_status <> 'pending' OR received_at < now() - interval '365 days')
  );

-- ---------------------------------------------------------------------------
-- Suppression source: who decided (ADR-0151 section 4)
-- ---------------------------------------------------------------------------
-- `operator` is every row that exists today (the manual form) and every row the
-- manual form writes. `provider_report` is a row an operator CONFIRMED from the
-- quarantine above: it still rests on an unauthenticated report, so the
-- dispatcher never lets it block `security` mail (a forged bounce must not lock
-- anyone out of a password reset). `provider_event_id` names that evidence (a
-- reference: the ledger row is purged on its own window).
ALTER TABLE awcms_email_suppression_list
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'operator',
  ADD COLUMN IF NOT EXISTS provider_event_id uuid;

ALTER TABLE awcms_email_suppression_list
  ADD CONSTRAINT awcms_email_suppression_list_source_check
    CHECK (source IN ('operator', 'provider_report')),
  ADD CONSTRAINT awcms_email_suppression_list_source_evidence_check
    CHECK ((source = 'provider_report') = (provider_event_id IS NOT NULL));

COMMENT ON COLUMN awcms_email_suppression_list.source IS
  'Issue #1161 / ADR-0151 section 4 - operator (entered by hand) or provider_report (an operator confirmed an unauthenticated provider event). A provider_report row never blocks security mail.';

-- ---------------------------------------------------------------------------
-- Binding an event to OUR message
-- ---------------------------------------------------------------------------
-- The intake looks a message up by the provider message id it stored after
-- acceptance (ADR-0151 M2), only among tenant-sender rows.
CREATE INDEX IF NOT EXISTS awcms_email_messages_provider_message_idx
  ON awcms_email_messages (tenant_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND sender_account_id IS NOT NULL;
