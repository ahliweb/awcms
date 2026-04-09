> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Multi-Tenant Theming

## Purpose

Describe how tenant branding and theme variables are currently applied across AWCMS admin and related public surfaces.

This guide focuses on the current runtime behavior rather than an abstract design-system theory.

## Current Theming Model

Current tenant theming relies on:

- tenant-stored branding/theme configuration
- runtime application of CSS variables
- semantic Tailwind utility usage built on those variables
- shared expectation that components avoid hardcoded brand colors

## Current Source Of Theme Data

Tenant branding currently lives in tenant configuration data and is applied from the current active tenant context.

Current important rule:

- the active scoped tenant determines which theme values are applied in admin flows

## Current Runtime Hook

`awcms/src/hooks/useTenantTheme.js` is the current hook that applies tenant theme variables to `document.documentElement`.

Current behavior includes:

- reading `tenant.config?.theme`
- applying `--primary` when `brandColor` is a valid `#RRGGBB` hex value
- applying `--font-sans` when `fontFamily` survives basic sanitization
- cleaning up variables when tenant context changes/unmounts

## Current Theme Variable Expectations

Current variables applied by the tenant theme hook include:

- `--primary`
- `--font-sans`

Other theme tokens may still be defined elsewhere in the design system, but these are the current tenant-applied runtime variables documented directly by the hook.

## Current Usage Pattern

Components should continue to use semantic utility classes rather than hardcoded theme values.

Example:

```jsx
<Button className="bg-primary text-primary-foreground">
  Action
</Button>
```

## Current Config Shape

Representative tenant config shape:

```json
{
  "theme": {
    "brandColor": "#3b82f6",
    "fontFamily": "Inter"
  }
}
```

This is an orientation example, not a guarantee that no additional tenant config keys exist.

## Current Public Surface Note

Public portals are expected to preserve the same semantic theming approach even though their runtime/build behavior differs from the admin app.

Current rule:

- use semantic theme variables and tokens consistently across admin/public surfaces instead of introducing hardcoded brand-specific color values in components

## Current Security And Validation Notes

The current hook performs basic input hardening before applying theme values:

- `brandColor` must match strict hex format
- `fontFamily` is sanitized before applying it to `--font-sans`

Current important rule:

- do not widen the accepted input shape casually without considering style injection risk

## Current Styling Standards

- no hardcoded hex values in component code when semantic tokens should be used
- use CSS variables and semantic Tailwind tokens
- preserve white-labeling and dark-mode compatibility

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/theming code | `cd awcms && npm run build` |
| public theming changes | `cd awcms-public/primary && npm run check:astro` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/modules/COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/dev/public.md](../dev/public.md)
- [../../awcms/src/hooks/useTenantTheme.js](../../awcms/src/hooks/useTenantTheme.js)
