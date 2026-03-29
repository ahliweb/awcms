---
description: Content sanitization and safe rendering rules for imported/user content
---

# Sanitize and Render

## When This Rule Applies

- Importing HTML content (Stitch, WordPress migration, paste)
- Rendering user-generated or imported HTML in admin or public portal
- Any component that uses `dangerouslySetInnerHTML` or similar
- Modifying sanitization utilities

## Sanitization Pipeline

### 1. Admin Import (Stitch)

File: `awcms/src/lib/stitch/sanitizeStitchHtml.js`

- Strips all `<script>`, `<iframe>`, `<object>`, `<embed>` tags
- Removes event handler attributes (`onclick`, `onerror`, etc.)
- Preserves allowlisted structural tags

### 2. Admin Fallback Rendering

File: `awcms/src/utils/sanitize.js`

- Applied when rendering `RawHTML` blocks in admin preview
- Uses explicit tag/attribute allowlist
- Strips unknown tags and attributes

### 3. Public Portal Rendering

File: `awcms-public/primary/src/utils/sanitize.ts`

- Applied via `PuckRenderer` for public-facing output
- Strictest allowlist — only safe structural and text tags
- No inline styles, no external resources

## Allowlisted Tags (Baseline)

```
p, br, strong, em, u, s, a, ul, ol, li, h1-h6,
blockquote, pre, code, table, thead, tbody, tr, th, td,
img (with src allowlist), span, div, figure, figcaption
```

## Never Do

- ❌ Use `dangerouslySetInnerHTML` without sanitization
- ❌ Allow `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>` in imported content
- ❌ Allow `javascript:` URLs in `href` or `src`
- ❌ Allow event handler attributes (`on*`)
- ❌ Trust imported HTML without running through sanitization pipeline
- ❌ Allow `style` attributes with `expression()` or `url()`

## Tenant-Controlled Import Settings

```json
{
  "key": "stitch_import",
  "value": {
    "enabled": true,
    "mode": "mapped",
    "max_input_kb": 500,
    "allow_raw_html_fallback": false
  }
}
```

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.5
- [docs/modules/STITCH_IMPORT.md](../../docs/modules/STITCH_IMPORT.md)
- [AGENTS.md](../../AGENTS.md) — Content sanitization patterns
