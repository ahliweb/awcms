# Access Log 5W+1H Contract

This document defines the normalized 5W+1H access-log shape written into `public.audit_logs`.

## Scope

The rollout extends the existing `audit_logs` table rather than introducing a parallel access-log table. This preserves compatibility with existing audit consumers while allowing route- and access-level logging across:

- `awcms/`
- `awcms-edge/`
- `awcms-public/primary/`
- `awcms-mobile/primary/`
- `awcms-esp32/primary/`

## Field Mapping

| Dimension | Columns |
| --- | --- |
| `who` | `tenant_id`, `user_id`, `actor_type`, `actor_role`, `auth_context` |
| `what` | `action`, `resource`, `module_name`, `feature_name`, `action_name`, `resource_type`, `resource_id`, `permission_key` |
| `when` | `created_at`, `server_timestamp`, `client_timestamp`, `request_duration_ms` |
| `where` | `workspace_source`, `route_path`, `url`, `screen_name`, `ip_address`, `user_agent`, `device_metadata` |
| `why` | `purpose`, `workflow_state`, `trigger_source`, `business_intent` |
| `how` | `channel`, `access_channel`, `access_mechanism`, `integration_source`, `auth_method` |

## Current Coverage

| Workspace | Coverage |
| --- | --- |
| `awcms/` | Login, SSO login, 2FA login success/failure, Mailketing settings audit writes use the normalized helper |
| `awcms-edge/` | Media upload session creation, public rebuild trigger, content transform, manage-users, and extension lifecycle success paths write normalized access events |
| `awcms-public/primary/` | Astro middleware logs public page views to both `analytics_events` and `audit_logs` |
| `awcms-mobile/primary/` | Auth sign-in and route/screen transitions log best-effort access events |
| `awcms-esp32/primary/` | Device log payloads now include 5W+1H-aligned metadata fields for downstream mapping |

## Notes

- `public.log_access_event(...)` is the shared database entrypoint for normalized access/audit writes.
- The migration is additive and keeps `action`, `resource`, `details`, `channel`, and existing readers intact.
- Trigger-based table audits continue to work. They populate legacy columns, while manual access logging fills the broader 5W+1H contract.
- Mobile and device logging are intentionally best-effort. Logging failures must not block app/device flows.
