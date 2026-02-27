> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 (Security) and Section 3 (Modules)
>
> **Context7 MCP Basis**:
>
> - `ueberdosis/tiptap-docs` (TipTap HTML import via editor content updates)
> - `puckeditor/puck` (Puck `data` contract: `content`, `root`, optional `zones`)
> - Current Context7 index does not expose a dedicated Stitch SDK entry for direct runtime API integration, so AWCMS uses an artifact import flow (paste exported HTML/CSS).

# Stitch Import (Per-Tenant)

## Purpose

Explain how Stitch HTML import works in AWCMS, how to configure it per tenant, and how safety controls are enforced across Admin and Public rendering.

## Audience

- Platform operators
- Tenant admins with extension configuration access
- Admin/public developers maintaining import flows

## Prerequisites

- [AGENTS.md](../../AGENTS.md) (tenant isolation, ABAC/RLS, Context7 workflow)
- [docs/modules/VISUAL_BUILDER.md](./VISUAL_BUILDER.md)
- [docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md](./PUBLIC_PORTAL_ARCHITECTURE.md)
- [docs/security/abac.md](../security/abac.md)

## Per-Tenant Configuration Model

AWCMS stores Stitch controls in `public.settings` with composite key `(tenant_id, key)` and `key = 'stitch_import'`.

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enables/disables Stitch import UI actions for the tenant |
| `mode` | string | `"html"` | `html` = single sanitized block, `mapped` = structured block mapping |
| `max_input_kb` | number | `256` | Max allowed import payload size before validation fails |
| `allow_raw_html_fallback` | boolean | `true` | Allows unsupported structures to be stored as `RawHTML` fallback blocks |

Runtime defaults are defined in `awcms/src/hooks/useStitchImportConfig.js` and apply when no DB row exists.

## How To Configure (Tenant Scope)

1. Open Admin panel and navigate to `Extensions`.
2. Open the **Settings** tab (`ExtensionSettings`).
3. In **Stitch Import Settings**, set:
   - Enable toggle
   - Import mode (`HTML (Sanitized)` or `Mapped Blocks`)
   - Max input size (16-4096 KB)
   - RawHTML fallback toggle
4. Click **Save Stitch Settings**.

Implementation entrypoints:

- UI: `awcms/src/components/dashboard/ExtensionSettings.jsx`
- Hook: `awcms/src/hooks/useStitchImportConfig.js`

## Editor Workflows

### TipTap (Rich Text Editors)

- Entrypoint: `Import from Stitch` toolbar button in `RichTextEditor`.
- Dialog: `awcms/src/components/stitch/ImportFromStitchDialog.jsx`.
- Flow:
  1. Paste HTML (and optional CSS)
  2. Validate size (`max_input_kb`)
  3. Sanitize preview and collect warnings
  4. Import into editor via `importToTiptap()`
- Result: sanitized HTML inserted via editor content update.

Key files:

- `awcms/src/components/ui/RichTextEditor.jsx`
- `awcms/src/lib/stitch/htmlToTiptap.js`

### Puck (Visual Builder)

- Entrypoint: `Import Stitch` button in visual builder toolbar.
- Flow:
  1. Open same import dialog
  2. Validate + sanitize input
  3. Convert with `importToPuck()` based on tenant `mode`
  4. Append generated blocks to existing Puck `data.content`
- `mode = "html"`:
  - single `RawHTML` block (or `Text` block if fallback disabled)
- `mode = "mapped"`:
  - best-effort mapping (`Image`, `Button`, `Divider`, `YouTube`, `Text`)
  - unsupported elements use `RawHTML` fallback when allowed

Key files:

- `awcms/src/components/visual-builder/VisualPageBuilder.jsx`
- `awcms/src/lib/stitch/htmlToPuck.js`
- `awcms/src/components/visual-builder/blocks/RawHTMLBlock.jsx`
- `awcms/src/components/visual-builder/config.js`

## Security Pipeline

| Stage | Enforcement |
| --- | --- |
| Import validation | `validateInput()` enforces required HTML and tenant size limit |
| Admin sanitization | `sanitizeStitchHtml()` strips unsafe tags/attrs and disallowed URLs |
| Fallback rendering (Admin) | `RawHTMLBlock` renders via `sanitizeHTML()` in admin utilities |
| Fallback rendering (Public) | `PuckRenderer` routes `RawHTML` through `getSanitizedRawHtml()` + `sanitizeHTML()` |

Public renderer hardening references:

- `awcms-public/primary/src/components/common/PuckRenderer.astro`
- `awcms-public/primary/src/components/common/puckRendererRawHtml.ts`
- `awcms-public/primary/src/utils/sanitize.ts`

## Operational Notes

- CSS from Stitch is accepted in the dialog for compatibility but currently ignored; warnings include `css_ignored`.
- Import warnings are informational and describe sanitization/fallback/dropped elements.
- Stitch import baseline migrations are active in `supabase/migrations/2026022415*.sql` and mirrored in `awcms/supabase/migrations/`.
- Runtime settings currently support `mode = html|mapped`; if a tenant has legacy values (for example `hybrid`), resave settings in `ExtensionSettings` to normalize.

## Verification Checklist (Per Tenant)

1. Save tenant setting with `enabled = true`.
2. Confirm import buttons are enabled in:
   - Rich text editor (`BlogEditor`, `PageEditor`, etc.)
   - Visual builder
3. Paste HTML containing unsafe payload (for example, `<script>` or `javascript:` URL).
4. Verify:
   - payload is sanitized
   - warnings are shown
   - no unsafe HTML executes on public pages

## Test Coverage

Stitch import test suite:

- `awcms/src/lib/stitch/__tests__/sanitizeStitchHtml.test.js`
- `awcms/src/lib/stitch/__tests__/htmlToTiptap.test.js`
- `awcms/src/lib/stitch/__tests__/htmlToPuck.test.js`
- `awcms/src/lib/stitch/__tests__/importToPuck.test.js`
- `awcms/src/components/ui/__tests__/RichTextEditor.stitch-import.test.jsx`
- `awcms/src/components/dashboard/__tests__/ExtensionSettings.stitch.test.jsx`
- `awcms-public/primary/src/components/common/__tests__/PuckRendererRawHtml.test.ts`
