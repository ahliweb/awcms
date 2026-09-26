-- Issue ahliweb/omes#232 (ADR-0122, OMES ADR-0029) — AI-privacy posture and
-- egress-approval permission catalog seed.
--
-- Two new `omes_control` permissions:
--   * `ai_privacy.read`    — read the tenant's AI privacy posture projection
--     and pending/decided egress-approval requests.
--   * `ai_privacy.approve` — submit an owner-approval decision on an
--     approval_required AI egress decision. Deliberately separate from
--     `ai_privacy.read` (read access to posture evidence does not imply the
--     authority to approve cloud egress of Confidential/Restricted data),
--     mirroring the existing `jobs.read` / `jobs.approve` split.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS).
-- Idempotent via ON CONFLICT (module_key, activity_code, action) DO NOTHING.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omes_control', 'ai_privacy', 'read', 'Read AI privacy posture evidence and egress-approval requests'),
  ('omes_control', 'ai_privacy', 'approve', 'Approve or deny an AI egress owner-approval request')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
