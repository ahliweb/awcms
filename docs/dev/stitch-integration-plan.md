> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)

# Stitch Integration Execution Plan

## Implementation Status (Audit 2026-02-27)

- This file is a mixed execution record: most integration work is implemented.
- Remaining unchecked items should be treated as backlog or optional follow-up, not release blockers for the shipped Stitch import baseline.

## Purpose

Provide an implementation-ready, file-by-file execution checklist to integrate Google Stitch design imports into AWCMS for both TipTap and Puck editors, with strict per-tenant controls and safe fallback behavior.

## Context7 Inputs Used

| Source | Context7 Library ID | Relevant Guidance |
| --- | --- | --- |
| TipTap docs | `ueberdosis/tiptap-docs` | `setContent` supports HTML/JSON and controlled parse options (`emitUpdate`, `parseOptions`) |
| Puck docs | `puckeditor/puck` | Data model contract is `data = { content, root, zones? }` and each item requires `type` + `props` |
| Google Stitch announcement | N/A in Context7 index | Current Stitch workflow supports UI generation, `Paste to Figma`, and front-end code export |

Notes:

- As of this plan, Context7 search does not expose a dedicated library entry for `stitch.withgoogle.com`.
- Integration therefore uses import workflows based on Stitch outputs (HTML/code artifacts), not direct Stitch API coupling.

## Confirmed Product Decisions

- Unsupported Stitch constructs in Puck use **safe fallback `RawHTML` block**.
- Import is **tenant-scoped** and controlled by tenant settings.
- Public rendering path must sanitize fallback HTML before output.

## Scope (v1)

- Add `Import from Stitch` UX in TipTap and Puck editor surfaces.
- Add shared Stitch import conversion/sanitization layer.
- Add tenant-level feature flags and audit trail for imports.
- Add public rendering sanitizer path for `RawHTML` fallback blocks.

## Non-Goals (v1)

- Direct Stitch API synchronization.
- Automated Figma API ingestion.
- Pixel-perfect conversion of every CSS construct from exported code.

## File-by-File Execution Checklist

### Phase A - Database, Tenant Control, and Security Baseline

- [x] `supabase/migrations/20260224150000_add_stitch_import_settings.sql`: seed tenant-level Stitch import settings (`stitch_import`) in `settings`.
- [x] `supabase/migrations/20260224151000_create_stitch_import_jobs.sql`: create import audit table (`stitch_import_jobs`) with RLS + tenant isolation policies.
- [x] `supabase/migrations/20260224152000_register_stitch_import_resource.sql`: register `stitch_import` in `resources_registry` and seed permission keys.
- [x] `docs/RESOURCE_MAP.md`: add `stitch_import` resource mapping entry (scope, permission prefix, table linkage).
- [x] `docs/security/overview.md`: document import sanitization and tenant controls.

### Phase B - Shared Stitch Import Core (Admin)

- [x] `awcms/src/lib/stitch/constants.js` (new): supported HTML tags, attribute allowlist, size limits, allowed URL schemes.
- [x] `awcms/src/lib/stitch/sanitizeStitchHtml.js` (new): strict DOMPurify policy wrapper for Stitch imports.
- [x] `awcms/src/lib/stitch/htmlToTiptap.js` (new): conversion helpers for TipTap-safe HTML insertion.
- [x] `awcms/src/lib/stitch/htmlToPuck.js` (new): HTML -> Puck `data` mapper with `RawHTML` fallback block generation.
- [x] `awcms/src/lib/stitch/createImportWarnings.js` (new): normalize dropped/unsupported element warnings.
- [x] `awcms/src/lib/stitch/index.js` (new): central API (`importToTiptap`, `importToPuck`, `validateInput`).

### Phase C - TipTap Integration

- [x] `awcms/src/components/ui/RichTextEditor.jsx`: add `Import from Stitch` toolbar action and invoke shared import service.
- [x] `awcms/src/components/stitch/ImportFromStitchDialog.jsx` (new): modal for pasted HTML (and optional CSS) + preview + warning summary.
- [x] `awcms/src/components/visual-builder/fields/RichTextField.jsx`: uses shared `RichTextEditor` so Stitch import behavior is inherited in Puck rich text fields.
- [x] `awcms/src/components/ui/LocalizedInput.jsx`: localized richtext mode uses shared `RichTextEditor`, preserving Stitch import flow per language tab.

### Phase D - Puck Integration + Safe Fallback Block

- [x] `awcms/src/components/visual-builder/VisualPageBuilder.jsx`: add `Import from Stitch` action in editor toolbar and update `data` via mapped Puck payload.
- [x] `awcms/src/components/visual-builder/blocks/RawHTMLBlock.jsx` (new): admin-side block for sanitized fallback HTML display.
- [x] `awcms/src/components/visual-builder/config.js`: register `RawHTML` block and field schema.
- [x] `awcms/src/utils/sanitize.js`: verify sanitation policy supports safe fallback rendering in admin.

### Phase E - Public Rendering Safety

- [x] `awcms-public/primary/src/components/common/PuckRenderer.astro`: route `RawHTML` through sanitizer before `set:html`.
- [x] `awcms-public/primary/src/utils/sanitize.ts`: replace passthrough sanitizer with strict safe sanitizer.
- [x] `awcms-public/primary/package.json`: add sanitizer dependency if needed (`isomorphic-dompurify` or approved equivalent).
- [x] `docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md`: document fallback block sanitization path.

### Phase F - Feature Flags and Tenant UX

- [x] `awcms/src/hooks/useStitchImportConfig.js` (new): load tenant config from `settings.key = 'stitch_import'`.
- [x] `awcms/src/components/dashboard/ExtensionSettings.jsx` or dedicated settings surface: expose `enabled`, `mode`, `max_input_kb`, `allow_raw_html_fallback`.
- [x] `awcms/src/components/ui/RichTextEditor.jsx`: hard-disable import action when tenant flag is off.
- [x] `awcms/src/components/visual-builder/VisualPageBuilder.jsx`: hard-disable import action when tenant flag is off.

### Phase G - Testing and Verification

- [x] `awcms/src/lib/stitch/__tests__/sanitizeStitchHtml.test.js` (new): XSS payload stripping coverage.
- [x] `awcms/src/lib/stitch/__tests__/htmlToPuck.test.js` (new): mapper contract (`content/root/zones`) and fallback behavior.
- [x] `awcms/src/lib/stitch/__tests__/importToPuck.test.js` (new): import mode behavior (`html` vs `mapped`) and size-limit validation.
- [x] `awcms/src/lib/stitch/__tests__/htmlToTiptap.test.js` (new): import normalization and expected HTML output.
- [x] `awcms-public/primary/src/components/common/__tests__/PuckRendererRawHtml.test.ts` (new): public-side sanitization proof.
- [x] `awcms/src/components/ui/__tests__/RichTextEditor.stitch-import.test.jsx` (new): toolbar import flow and warning UX.
- [x] `awcms/src/components/dashboard/__tests__/ExtensionSettings.stitch.test.jsx` (new): tenant stitch settings save/validation/refresh behavior.

## Migration Skeletons Added

| File | Purpose | Key Entities |
| --- | --- | --- |
| `supabase/migrations/20260224150000_add_stitch_import_settings.sql` | Tenant-level feature defaults | `settings` (`stitch_import`) |
| `supabase/migrations/20260224151000_create_stitch_import_jobs.sql` | Import auditing and diagnostics | `stitch_import_jobs` + RLS |
| `supabase/migrations/20260224152000_register_stitch_import_resource.sql` | Resource and permission registry | `resources_registry`, `permissions` |

## Acceptance Criteria

- TipTap can import Stitch HTML and save safely without script/event-handler execution.
- Puck can import Stitch HTML and map known structures; unknown structures render via sanitized `RawHTML` fallback.
- Public portal never renders unsanitized fallback HTML.
- Tenant A cannot read/write Stitch import logs or config for Tenant B.
- Feature flag can disable all Stitch import entry points per tenant.

## Rollout Strategy

1. Apply migrations in staging.
2. Enable feature for internal tenant only (`stitch_import.enabled = true`).
3. Validate import quality and warning telemetry from `stitch_import_jobs`.
4. Roll out tenant-by-tenant.

## Rollback Strategy

- Disable import instantly via `settings.key = 'stitch_import'` (`enabled: false`).
- Keep audit table (`stitch_import_jobs`) for forensic traceability.
- If needed, remove UI entry points while preserving stored imported content.
