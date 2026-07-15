BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS awcms_schema_migrations (
  id bigserial PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  checksum text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS awcms_modules (
  module_key text PRIMARY KEY,
  module_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version text NOT NULL DEFAULT '0.1.0',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
