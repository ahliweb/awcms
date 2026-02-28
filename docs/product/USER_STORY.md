> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) → [AGENTS.md](../../AGENTS.md) → [PRD.md](PRD.md)

# AWCMS — User Stories

## Platform Owner / Super Admin

| ID | Story | Acceptance |
|----|-------|------------|
| PO-1 | As a Platform Owner, I can provision new tenants so that each organization gets an isolated workspace | Tenant created with defaults; admin invited; RLS enforced from first query |
| PO-2 | As a Platform Owner, I can manage global modules so that capabilities can be enabled/disabled per tenant | Module registry updated; tenant-level overrides respected |
| PO-3 | As a Super Admin, I can view audit logs across tenants so that I can investigate incidents | Cross-tenant audit view restricted to platform-level roles only |
| PO-4 | As a Platform Owner, I can manage the staff hierarchy so that role permissions stay consistent | Hierarchy changes propagate to `role_permissions`; UI reflects immediately |

## Tenant Admin

| ID | Story | Acceptance |
|----|-------|------------|
| TA-1 | As a Tenant Admin, I can manage users within my tenant so that access is controlled | User CRUD scoped to own tenant_id; cannot see other tenants' users |
| TA-2 | As a Tenant Admin, I can customize branding so that the public portal matches my organization | Theme changes saved to tenant settings; public portal reflects on next build |
| TA-3 | As a Tenant Admin, I can assign roles to users so that permissions match job functions | Role assignment updates `role_permissions`; UI menus update accordingly |
| TA-4 | As a Tenant Admin, I can configure Stitch import settings so that content import is controlled | `stitch_import` setting saved; import modes enforced per configuration |
| TA-5 | As a Tenant Admin, I can view my tenant's audit trail so that I can monitor activity | Audit logs filtered by own tenant_id; no cross-tenant leakage |

## Editor / Author

| ID | Story | Acceptance |
|----|-------|------------|
| ED-1 | As an Editor, I can review and approve content so that quality standards are maintained | Status transitions (draft → review → published) enforced by permission checks |
| ED-2 | As an Editor, I can manage media files so that content has proper assets | Media uploads scoped to tenant bucket; file type validation enforced |
| AU-1 | As an Author, I can create and edit my own content so that I contribute to the site | Create/update restricted to own `author_id`; cannot modify others' content |
| AU-2 | As an Author, I can use the visual page builder so that I create rich layouts | Puck editor loads tenant-scoped templates; saves content with correct `tenant_id` |

## Member / Subscriber

| ID | Story | Acceptance |
|----|-------|------------|
| ME-1 | As a Member, I can manage my profile so that my information is current | Profile edits scoped to own `user_id`; cannot access other profiles |
| SU-1 | As a Subscriber, I can access premium content so that I get value from my subscription | Tier-gated content checks `tierFeatures`; unauthorized access returns 403 |

## Public User

| ID | Story | Acceptance |
|----|-------|------------|
| PU-1 | As a Public User, I can browse published content so that I find information | Static pages served; only `status = published` and `deleted_at IS NULL` shown |
| PU-2 | As a Public User, I can search content so that I find specific information | Search scoped to tenant's published content; no draft/deleted content leaked |
| PU-3 | As a Public User, I am informed about data collection so that I can consent | Analytics consent banner shown; telemetry respects consent setting |

## Tenant Auditor

| ID | Story | Acceptance |
|----|-------|------------|
| AD-1 | As an Auditor, I can view audit logs within my tenant so that I can monitor all write operations | Audit log view filtered by own `tenant_id`; read-only — no create/update/delete actions available |
| AD-2 | As an Auditor, I can generate compliance reports so that regulatory obligations are documented | Reports scoped to own tenant; exportable as PDF/CSV; no cross-tenant data included |
| AD-3 | As an Auditor, I can verify content integrity so that published content matches approved versions | Content diff view shows version history; `deleted_at` records visible for audit purposes |

## IoT / Device Operator

| ID | Story | Acceptance |
|----|-------|------------|
| IO-1 | As a Device Operator, I can register ESP32 devices so that they connect to the correct tenant | Device registered with `tenant_id` and unique `device_id`; credentials scoped to tenant |
| IO-2 | As a Device Operator, I can push content to digital signage so that public displays stay current | Content push targets devices within own tenant only; display content is published-only |
| IO-3 | As a Device Operator, I can trigger firmware OTA updates so that devices run the latest version | OTA manifest served per-tenant; devices only accept firmware flagged for their `tenant_id` |

## AI-Assisted Content (Cross-Persona)

| ID | Story | Acceptance |
|----|-------|------------|
| AI-1 | As an Editor, I can use AI to generate content drafts so that content creation is accelerated | AI drafts scoped to tenant's OpenClaw agent workspace; output saved as draft (not auto-published) |
| AI-2 | As an Editor, I can use AI-assisted translation so that content is available in multiple languages | Translation requests routed through per-tenant AI agent; output stored with correct `locale` |
| AI-3 | As a Tenant Admin, I can review AI-generated content suggestions so that quality standards are maintained | AI suggestions appear in review queue; require human approval before publishing |

## Multi-Language Content (Cross-Persona)

| ID | Story | Acceptance |
|----|-------|------------|
| ML-1 | As an Editor, I can create content in multiple languages so that the site serves diverse audiences | Content entries support `locale` field; each translation linked to the parent entry |
| ML-2 | As a Public User, I can switch display language so that I read content in my preferred language | Language switcher shows available translations; URL reflects locale; fallback to default language |
| ML-3 | As a Tenant Admin, I can configure available languages so that only relevant locales are enabled | Enabled locales stored in tenant settings; public portal builds only active locale pages |

## Email Integration (Cross-Persona)

| ID | Story | Acceptance |
|----|-------|------------|
| EM-1 | As a Tenant Admin, I can manage newsletter campaigns so that subscribers receive updates | Campaign CRUD scoped to own `tenant_id`; sends via Mailketing SMTP; delivery status tracked |
| EM-2 | As a Tenant Admin, I can manage subscriber lists so that email targeting is accurate | Subscriber lists isolated per tenant; import/export available; unsubscribe honored per UU PDP |

## References

- [PRD.md](PRD.md) — Product requirements
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — Testable requirements
- [HIERARCHY.md](../tenancy/HIERARCHY.md) — Role hierarchy details
- [abac.md](../security/abac.md) — Permission system details
- [INTERNATIONALIZATION.md](../modules/INTERNATIONALIZATION.md) — Multi-language module
- [EMAIL_INTEGRATION.md](../modules/EMAIL_INTEGRATION.md) — Email module
- [esp32.md](../dev/esp32.md) — IoT development guide
