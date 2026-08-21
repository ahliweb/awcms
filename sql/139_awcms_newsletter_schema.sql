-- Issue #598 / ADR-0103 — a reader can join a list.
--
-- The `email` module can SEND mail: templates, an outbox with lease claiming,
-- retry, backoff, a circuit breaker, per-address suppression. What did not exist
-- is a subscriber list a reader can join from a public page. Those are two
-- capabilities, and the legacy portal has both — so migrating the second tenant
-- without this is a functional regression, not a gap.
--
-- ## Four states, and the fourth is not the third
--
-- `pending` -> `active`, with `unsubscribed` and `suppressed` as terminal
-- branches. They are kept apart because re-subscribing is allowed from one and
-- not the other: somebody who unsubscribed in March may sign up again in June,
-- and letting them is correct. An address suppressed for abuse must not be
-- re-addable by whoever is abusing it. A single `inactive` state would make that
-- a matter of remembering rather than of the type.
--
-- ## Both tokens are HASHED
--
-- They are bearer credentials: whoever holds the confirmation token can confirm
-- a subscription, whoever holds the unsubscribe token can end one. A database
-- read must not hand either over — the same reason session tokens are hashed.
--
-- The unsubscribe token is STABLE for the row's lifetime because it is printed
-- in the footer of every message this subscriber will ever receive. Rotating it
-- would break every link already sitting in someone's inbox.
--
-- ## `consent_at` records what happened, not what was asked for
--
-- Written when the confirmation link is FOLLOWED, never at submission. A row
-- that never confirmed carries no consent timestamp, which is the truth about
-- it, and `consent_ip_hash` records where the confirmation came from rather than
-- where the form was submitted from.
--
-- ## Uniqueness is on the NORMALIZED address
--
-- `email_normalized` is what the unique index covers, so `Ani@Example.COM` and
-- `ani@example.com` are one subscriber. The display form is kept beside it
-- because that is what the person typed and what a support conversation will
-- quote back. FR-NWL-005's idempotency rests on this index, not on the
-- application remembering to check first.

CREATE TABLE IF NOT EXISTS awcms_newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),

  -- As typed, for a support conversation. Never used for matching.
  email text NOT NULL,
  -- Lower-cased and trimmed by the application; every lookup uses THIS.
  email_normalized text NOT NULL,

  status text NOT NULL DEFAULT 'pending',

  -- Where the subscription came from. Free-form on purpose: a tenant importing a
  -- legacy list wants to say so, and an enum would need a migration per import.
  source text NOT NULL DEFAULT 'public_form',
  locale text,

  -- Double opt-in. Null once confirmed: the token is spent, and keeping a spent
  -- bearer credential is keeping a credential.
  confirmation_token_hash text,
  confirmation_sent_at timestamptz,
  confirmed_at timestamptz,

  -- Stable for the row's lifetime — see the header.
  unsubscribe_token_hash text NOT NULL,

  consent_at timestamptz,
  consent_ip_hash text,

  unsubscribed_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT awcms_newsletter_subscribers_status_check
    CHECK (status IN ('pending', 'active', 'unsubscribed', 'suppressed')),

  -- An `active` row is one that confirmed. Without this the application could
  -- write an active subscriber with no consent record at all, which is the one
  -- state this table exists to make impossible.
  CONSTRAINT awcms_newsletter_subscribers_consent_check
    CHECK (
      status <> 'active'
      OR (confirmed_at IS NOT NULL AND consent_at IS NOT NULL)
    ),

  -- A suppression is an operator's or a provider's decision, and a decision with
  -- no recorded reason is indistinguishable from a mistake.
  CONSTRAINT awcms_newsletter_subscribers_suppression_check
    CHECK (
      status <> 'suppressed'
      OR (suppressed_at IS NOT NULL AND suppression_reason IS NOT NULL)
    )
);

-- FR-NWL-005 — idempotency is the INDEX's job, not the application's memory.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_newsletter_subscribers_email_dedup
  ON awcms_newsletter_subscribers (tenant_id, email_normalized);

-- The admin screen lists by status, newest first.
CREATE INDEX IF NOT EXISTS awcms_newsletter_subscribers_status_idx
  ON awcms_newsletter_subscribers (tenant_id, status, created_at DESC);

-- Token lookups are the anonymous confirm/unsubscribe path, so they must not
-- scan. Partial: a spent confirmation token is null and indexing nulls here
-- would be indexing every confirmed subscriber for a lookup that never happens.
CREATE INDEX IF NOT EXISTS awcms_newsletter_subscribers_confirmation_token_idx
  ON awcms_newsletter_subscribers (tenant_id, confirmation_token_hash)
  WHERE confirmation_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_newsletter_subscribers_unsubscribe_token_idx
  ON awcms_newsletter_subscribers (tenant_id, unsubscribe_token_hash);

-- Retention (`data_lifecycle`) sweeps by `created_at` for pending rows.
CREATE INDEX IF NOT EXISTS awcms_newsletter_subscribers_created_at_idx
  ON awcms_newsletter_subscribers (tenant_id, created_at);

ALTER TABLE awcms_newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_newsletter_subscribers FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_newsletter_subscribers_tenant_isolation
  ON awcms_newsletter_subscribers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` (sql/022) — the retention sweep for `pending` rows nobody ever
-- confirmed. SELECT to find them, DELETE to remove them; no UPDATE, because the
-- job never changes a subscriber's state, it only removes an unfinished request.
GRANT SELECT, DELETE ON awcms_newsletter_subscribers TO awcms_worker;

COMMENT ON COLUMN awcms_newsletter_subscribers.status IS
  'ADR-0103 — `unsubscribed` is the SUBSCRIBER''s decision, `suppressed` is the operator''s or the provider''s. Re-subscribing is allowed from the first and not the second, which is why they are not one `inactive` state.';

COMMENT ON COLUMN awcms_newsletter_subscribers.unsubscribe_token_hash IS
  'ADR-0103 — hashed, and STABLE for the row''s lifetime: it is printed in the footer of every message this subscriber receives, so rotating it breaks links already in inboxes.';

COMMENT ON COLUMN awcms_newsletter_subscribers.consent_at IS
  'ADR-0103 — written when the confirmation link is FOLLOWED, never at submission. A row that never confirmed carries no consent, which is the truth about it.';

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('newsletter', 'subscribers', 'read', 'Read this tenant''s newsletter subscriber list and its status counts'),
  ('newsletter', 'subscribers', 'configure', 'Suppress a subscriber, or remove one at their request')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
