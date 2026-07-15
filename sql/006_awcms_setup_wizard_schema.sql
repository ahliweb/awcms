CREATE TABLE IF NOT EXISTS awcms_setup_state (
  id boolean PRIMARY KEY DEFAULT true,
  tenant_id uuid REFERENCES awcms_tenants (id),
  locked_at timestamptz,
  CONSTRAINT awcms_setup_state_singleton CHECK (id)
);
