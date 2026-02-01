# Admin/Public DB-Driven Checklist (AWCMS)

This checklist aligns `docs/security/abac.md`, `docs/RESOURCE_MAP.md`, and `docs/architecture/standards.md` with a database-driven Admin UI/UX that controls all public tenants (`awcms-public/primary`, `awcms-public/smandapbun`).

## Legend

- [ ] Pending
- [x] Done

## 1) Navigation & Menus (tenant.menu.*)

- [ ] **DB**: Ensure `menus` entries exist for `location` = `header`, `footer`, `public_sidebar`, `mobile_menu` (per tenant).
- [ ] **Admin**: `awcms/src/components/dashboard/MenusManager.jsx` stays the source of truth; verify it writes correct `location` and `parent_id` tree.
- [x] **Public (primary)**:
  - [x] `awcms-public/primary/src/lib/menu.ts` -> read hierarchical `menus` table and build nested menu items.
  - [x] `awcms-public/primary/src/layouts/PageLayout.astro` -> load header/footer from DB (fallback to `navigation.ts`).
  - [x] `awcms-public/primary/src/layouts/SidebarLayout.astro` -> same as above.
  - [x] `awcms-public/primary/src/layouts/LandingLayout.astro` -> use DB header subset (fallback to `navigation.ts`).
- [x] **Public (smandapbun)**:
  - [x] `awcms-public/smandapbun/src/lib/api.ts` -> add menu helper (menus table + tenant slug).
  - [x] `awcms-public/smandapbun/src/components/Header.astro` -> use DB menu tree with JSON fallback.
  - [x] `awcms-public/smandapbun/src/components/Footer.astro` -> use DB footer groups with JSON fallback.

## 2) Pages & Visual Builder (tenant.page.*, tenant.visual_pages.*)

- [ ] **DB**: Confirm `pages` entries use `editor_type` + `puck_layout_jsonb` and ABAC prefixes in `resources_registry`.
- [ ] **Admin**:
  - [ ] Add `ui_configs` entries for `pages` (table + form) and `visual_builder` (settings form).
  - [ ] Use `component_registry` for Puck/TipTap configs (per tenant).
- [x] **Public (primary)**:
  - [x] Keep `/p/[slug].astro` as single source for DB pages.
  - [x] Replace hardcoded widget home in `src/pages/index.astro` with a visual page (`page_type = home`).
- [ ] **Public (smandapbun)**:
  - [ ] Decide: keep page data in `settings` JSON (`page_*`) or migrate to `pages`.
  - [ ] If migrating, update `src/pages/**` to fetch `pages` by slug (similar to primary).

## 3) Blogs / News / Announcements (tenant.blog.*, tenant.announcements.*, tenant.promotions.*)

- [ ] **DB**: Ensure `blogs`, `announcements`, `promotions` tables are tenant-scoped and published.
- [ ] **Admin**: Add `ui_configs` for list + form per resource; enable publish workflow.
- [ ] **Public (primary)**: `src/lib/content.ts` already fetches `blogs`; add routes/widgets for announcements/promotions as needed.
- [ ] **Public (smandapbun)**: replace `src/data/blogs/*.json` with DB-backed reads (blogs/announcements).

## 4) Media & Galleries (tenant.files.*, tenant.photo_gallery.*, tenant.video_gallery.*, tenant.school_pages.*)

- [ ] **DB**: Standardize `site_images` settings key and gallery tables.
- [ ] **Admin**: Add schema for `site_images`, `photo_gallery`, `video_gallery`.
- [ ] **Public (primary)**: wire widgets to `site_images` + gallery tables (remove hardcoded URLs).
- [ ] **Public (smandapbun)**: replace `src/data/images.json` with `site_images` settings.

## 5) Settings, Branding & SEO (tenant.setting.*, tenant.seo.*, tenant.languages.*)

- [ ] **DB**: Verify `settings` keys for `seo_global`, `site_info`, `contact_info`, `branding`.
- [ ] **Admin**: create `ui_configs` for SEO + branding + contact.
- [x] **Public (primary)**: extend middleware to load branding/contact settings.
- [x] **Public (smandapbun)**: replace `src/data/site.json` and `contact.json` with settings data.

## 6) School Pages (smandapbun-specific)

- [ ] **DB**: add settings keys for `page_profile`, `page_services`, `page_finance`, `page_staff`, `page_achievements`, `page_alumni`, `page_gallery`, `page_agenda`, `page_contact`, `page_school_info`.
- [ ] **Admin**: create `ui_configs` per `page_*` key and map to `settings` table.
- [ ] **Public (smandapbun)**: ensure `src/lib/api.ts` reads all `page_*` keys (no JSON fallback).

## 7) Commerce (tenant.products.*, tenant.product_types.*, tenant.orders.*)

- [ ] **DB**: confirm commerce tables are tenant-scoped and published.
- [ ] **Admin**: add `ui_configs` for products/orders.
- [ ] **Public**: add storefront routes if required (not currently in public templates).

## 8) Public Tenant Resolution (multi-tenant)

- [ ] **Public (primary)**: middleware already resolves tenant by path/host.
- [ ] **Public (smandapbun)**: add tenant resolution (middleware) or keep fixed slug if only single-tenant.

## 9) Documentation Sync

- [ ] Update `docs/RESOURCE_MAP.md` if new resources/settings keys are added.
- [ ] Update `docs/dev/public.md` with DB-driven menu/page notes.
