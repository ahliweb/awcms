# AWCMS Resource Map

> **Documentation Authority**: [SYSTEM_MODEL.md](../SYSTEM_MODEL.md) -> [AGENTS.md](../AGENTS.md) -> [README.md](../README.md) -> [DOCS_INDEX.md](../DOCS_INDEX.md)

## Purpose

Provide a cleaned-up reference for the AWCMS `resources_registry` without repeating redundant settings-backed entries.

## Canonical Sources

- `public.resources_registry` is the live registry table.
- [docs/architecture/database.md](architecture/database.md) defines the registry schema.
- [docs/security/abac.md](security/abac.md) is the canonical permission-prefix reference.
- [docs/modules/MODULES_GUIDE.md](modules/MODULES_GUIDE.md) is the canonical admin-module map.

## How This Map Is Trimmed

- This file lists unique operational resources first.
- Settings-backed admin views that share the same underlying table are grouped instead of repeated inline.
- Dev/test-only seed data such as `test_dynamic` is intentionally excluded from the canonical map.

## Canonical Resource Registry

| Resource Key | Scope | Permission Prefix | Admin Surface | Backing Table/Store | Notes |
| --- | --- | --- | --- | --- | --- |
| `blogs` | Tenant | `tenant.blog` | Blogs | `blogs` | Canonical content table after resource-registry parity fixes |
| `pages` | Tenant | `tenant.page` | Pages | `pages` | Core page manager |
| `visual_builder` | Tenant | `tenant.visual_pages` | Visual Builder | `visual_pages` | Visual page builder resources |
| `themes` | Tenant | `tenant.theme` | Themes | `themes` | Tenant theme management |
| `widgets` | Tenant | `tenant.widgets` | Widgets | `widgets` | Widget registry and placement |
| `portfolio` | Tenant | `tenant.portfolio` | Portfolio | `portfolio` | Public portfolio content |
| `testimonials` | Tenant | `tenant.testimonies` | Testimonials | `testimonies` | Resource key remains `testimonials`; backing content uses `testimonies` |
| `announcements` | Tenant | `tenant.announcements` | Announcements | `announcements` | Tenant-scoped notice content |
| `promotions` | Tenant | `tenant.promotions` | Promotions | `promotions` | Commerce/content promotions |
| `contact_messages` | Tenant | `tenant.contact_messages` | Contact Messages | `contact_messages` | Inbound public contact submissions |
| `contacts` | Tenant | `tenant.contacts` | Contacts CRM | `contacts` | Tenant CRM contacts |
| `files` | Tenant | `tenant.files` | Media Library | `media_objects` | Media library is backed by `media_objects`, not `files` |
| `photo_gallery` | Tenant | `tenant.photo_gallery` | Photo Gallery | `photo_gallery` | Gallery records after parity fix |
| `video_gallery` | Tenant | `tenant.video_gallery` | Video Gallery | `video_gallery` | Gallery records after parity fix |
| `products` | Tenant | `tenant.products` | Products | `products` | Commerce catalog |
| `product_types` | Tenant | `tenant.product_types` | Product Types | `product_types` | Commerce taxonomy |
| `orders` | Tenant | `tenant.orders` | Orders | `orders` | Commerce orders |
| `menus` | Tenant | `tenant.menu` | Menu Manager | `menus` | Navigation menus |
| `categories` | Tenant | `tenant.categories` | Categories | `categories` | Tenant taxonomy; `content` scope is shared across blogs and pages |
| `tags` | Tenant | `tenant.tag` | Tags | `tags` | Tenant-scoped shared tags reused across supported modules |
| `users` | Tenant | `tenant.user` | Users | `users` | Registry parity fixed from legacy `profiles` mapping |
| `roles` | Tenant | `tenant.role` | Roles & Permissions | `roles` | Tenant role management |
| `policies` | Tenant | `tenant.policy` | Policies | `policies` | Tenant policy rules |
| `visitor_stats` | Tenant | `tenant.analytics` | Visitor Statistics | `analytics_events` | Admin analytics surface |
| `seo_manager` | Tenant | `tenant.seo` | SEO Manager | `seo_metadata` | Registry parity fixed from legacy `seo_settings` mapping |
| `languages` | Tenant | `tenant.languages` | Languages | `languages` | Tenant language config |
| `notifications` | Tenant | `tenant.notification` | Notifications | `notifications` | In-app notifications |
| `audit_logs` | Tenant | `tenant.audit` | Audit Logs | `audit_logs` | Compliance/audit read surface |
| `sso` | Tenant | `tenant.sso` | SSO & Security | `sso_providers` | Registry parity fixed from legacy `sso_config` mapping |
| `iot_devices` | Tenant | `tenant.iot` | IoT Devices | `devices` | Registry parity fixed from legacy `iot_devices` mapping |
| `mobile_users` | Tenant | `tenant.mobile_users` | Mobile Users | `mobile_users` | Mobile account management |
| `push_notifications` | Tenant | `tenant.push_notifications` | Push Notifications | `push_notifications` | Mobile notification surface |
| `extensions` | Platform | `platform.extensions` | Extensions | `extensions` | Platform extension lifecycle |
| `modules` | Platform | `platform.module` | Modules | `modules` | Platform module lifecycle |
| `sidebar_manager` | Platform | `platform.sidebar` | Sidebar Manager | `admin_menus` | Platform navigation configuration |
| `tenants` | Platform | `platform.tenant` | Tenant Management | `tenants` | Platform tenant administration |

## Grouped Settings-Backed Views

These resource keys are valid, but they are grouped here because they reuse the same backing store or represent closely related admin surfaces.

| Resource Key | Permission Prefix | Admin Surface | Backing Table | Grouping Reason |
| --- | --- | --- | --- | --- |
| `school_pages` | `tenant.school_pages` | School Website | `settings` | Same settings store as site-level tenant configuration |
| `site_images` | `tenant.school_pages` | Site Images | `settings` | Same permission family and settings-backed storage as `school_pages` |
| `settings_general` | `tenant.setting` | General Settings | `settings` | Shared settings resource family |
| `settings_branding` | `tenant.setting` | Branding | `settings` | Shared settings resource family |
| `email_settings` | `tenant.setting` | Email Settings | `settings` | Shared settings resource family; remains visible with activation guidance when Mailketing is inactive |
| `mobile_config` | `tenant.mobile` | App Config | `settings` | Mobile-specific settings surface |
| `email_logs` | `tenant.setting` | Email Logs | `email_logs` | Operationally separate table, but grouped with email/settings surfaces to avoid duplicate configuration rows |

## Removed From The Canonical List

| Entry | Reason |
| --- | --- |
| `test_dynamic` | Test-only seed resource from `20260201133000_seed_test_schema.sql`; not a canonical product resource |

## Dynamic UI Note

- `RolesManager` is a known example of a dashboard surface that can be rendered through `GenericContentManager`.
- `ui_configs` stores table/form schemas per resource.
- `component_registry` stores editor configuration such as TipTap and Puck settings.
