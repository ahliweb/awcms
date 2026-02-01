# AWCMS Resource System Documentation

## Overview

This document serves as the authoritative registry of all resources within AWCMS. It maps technical resource keys to their UI representation, DB tables, and functional components. The registry is backed by the `resources_registry` table with ABAC-aligned permission prefixes. UI schemas live in `ui_configs`, and editor/component settings live in `component_registry`.

## Resource Registry (Draft Audit)

| Resource Key | Scope | Permission Prefix | UI Label | Component Type | DB Table |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `blogs` | Tenant | `tenant.blog` | Blogs | Content | `posts` |
| `pages` | Tenant | `tenant.page` | Pages | Content | `pages` |
| `visual_builder` | Tenant | `tenant.visual_pages` | Visual Builder | Settings/Builder | `visual_pages` |
| `themes` | Tenant | `tenant.theme` | Themes | Config | `themes` |
| `widgets` | Tenant | `tenant.widgets` | Widgets | Config | `widgets` |
| `portfolio` | Tenant | `tenant.portfolio` | Portfolio | Content | `portfolio` |
| `testimonials` | Tenant | `tenant.testimonies` | Testimonials | Content | `testimonials` |
| `announcements` | Tenant | `tenant.announcements` | Announcements | Content | `announcements` |
| `promotions` | Tenant | `tenant.promotions` | Promotions | Content | `promotions` |
| `school_pages` | Tenant | `tenant.school_pages` | School Website | Settings | `settings` |
| `site_images` | Tenant | `tenant.school_pages` | Site Images | Settings | `settings` |
| `contact_messages` | Tenant | `tenant.contact_messages` | Contact Messages | Data | `contact_messages` |
| `contacts` | Tenant | `tenant.contacts` | Contacts CRM | Data | `contacts` |
| `files` | Tenant | `tenant.files` | Media Library | Media | `storage` (virtual) |
| `photo_gallery` | Tenant | `tenant.photo_gallery` | Photo Gallery | Media | `galleries` |
| `video_gallery` | Tenant | `tenant.video_gallery` | Video Gallery | Media | `galleries` |
| `products` | Tenant | `tenant.products` | Products | Commerce | `products` |
| `product_types` | Tenant | `tenant.product_types` | Product Types | Commerce | `product_types` |
| `orders` | Tenant | `tenant.orders` | Orders | Commerce | `orders` |
| `menus` | Tenant | `tenant.menu` | Menu Manager | Navigation | `menus` |
| `categories` | Tenant | `tenant.categories` | Categories | Taxonomy | `categories` |
| `tags` | Tenant | `tenant.tag` | Tags | Taxonomy | `tags` |
| `users` | Tenant | `tenant.user` | Users | RBAC | `profiles` |
| `roles` | Tenant | `tenant.role` | Roles & Permissions | RBAC | `roles` |
| `policies` | Tenant | `tenant.policy` | Policies | Data | `policies` |
| `seo_manager` | Tenant | `tenant.seo` | SEO Manager | Settings | `seo_settings` |
| `languages` | Tenant | `tenant.languages` | Languages | Config | `languages` |
| `extensions` | Platform | `platform.extensions` | Extensions | System | `extensions` |
| `modules` | Platform | `platform.module` | Modules | System | `modules` |
| `sidebar_manager` | Platform | `platform.sidebar` | Sidebar Manager | Config | `admin_menus` |
| `notifications` | Tenant | `tenant.notification` | Notifications | Data | `notifications` |
| `audit_logs` | Tenant | `tenant.audit` | Audit Logs | Logs | `audit_logs` |
| `settings_general` | Tenant | `tenant.setting` | General Settings | Settings | `settings` |
| `settings_branding`| Tenant | `tenant.setting` | Branding | Settings | `settings` |
| `sso` | Tenant | `tenant.sso` | SSO & Security | Config | `sso_config` |
| `email_settings` | Tenant | `tenant.setting` | Email Settings | Config | `settings` |
| `email_logs` | Tenant | `tenant.setting` | Email Logs | Logs | `email_logs` |
| `iot_devices` | Tenant | `tenant.iot` | IoT Devices | IoT | `iot_devices` |
| `mobile_users` | Tenant | `tenant.mobile_users` | Mobile Users | Mobile | `mobile_users` |
| `push_notifications`| Tenant | `tenant.push_notifications` | Push Notifications | Mobile | `push_notifications` |
| `mobile_config` | Tenant | `tenant.mobile` | App Config | Mobile | `settings` |
| `tenants` | Platform | `platform.tenant` | Tenant Management | System | `tenants` |

## UI Components Map

### Hardcoded components to be replaced by Dynamic UI

- `SchoolPagesManager` -> `DynamicResourceManager(resource='school_pages')`
- `RolesManager` -> `DynamicTable(resource='roles')`

## Editor Configurations

- **TipTap**: Configuration stored in `component_registry` table.
- **Puck**: Components allowed stored in `puck_components` table or JSON field.
