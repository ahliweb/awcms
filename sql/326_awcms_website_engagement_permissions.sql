-- website_engagement -- permission catalogue (Issue #1153, ADR-0155 section 8).
--
-- Admin reads are DEFAULT-DENY behind these triples; the public intake endpoint
-- is the only unauthenticated surface and needs none (it is authenticated by the
-- source token). `reveal` is its own permission so that decrypting a visitor's
-- identifiers is a separately grantable, audited act: a CRM consumer is given
-- `reveal`, a content editor is not.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('website_engagement', 'sources', 'read',
   'Read this tenant''s website sources (name, status, hosts, consent copy version, challenge mode and the non-sensitive token prefix; never the token)'),
  ('website_engagement', 'sources', 'manage',
   'Create, change, pause, revoke and delete a website source, edit the hosts it accepts, and rotate its token. The token is shown once (high-risk, audited at warning)'),
  ('website_engagement', 'submissions', 'read',
   'Read website submissions with masked contact details, consent provenance and source attribution'),
  ('website_engagement', 'submissions', 'reveal',
   'Decrypt and read a submission''s contact details and message. Every reveal is audited (high-risk, audited at warning)'),
  ('website_engagement', 'submissions', 'withdraw',
   'Withdraw a submission at the data subject''s request or on a consent withdrawal, and announce the withdrawal to downstream consumers (audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
