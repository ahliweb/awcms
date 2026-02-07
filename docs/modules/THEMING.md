> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.4 (Styling)

# Multi-Tenant Theming

## Purpose

Describe how tenant branding is stored and applied across the admin UI.

## Audience

- Admin panel developers
- Designers defining tenant branding

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for theming and styling system
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/tenancy/overview.md`

## Core Concepts

- Branding lives in `tenants.config` (JSONB).
- `useTenantTheme()` applies CSS variables at runtime.
- Components use Tailwind tokens that map to CSS variables.
- Public portal widgets follow the same CSS variable tokens for consistent theming.

## How It Works

- Hook: `awcms/src/hooks/useTenantTheme.js`.
- Variables set on `document.documentElement`:
  - `--primary`
  - `--font-sans`

## Implementation Patterns

### Tenant Config Example

```json
{
  "theme": {
    "brandColor": "#3b82f6",
    "fontFamily": "Inter"
  }
}
```

### Usage in Components

```jsx
<Button className="bg-primary text-primary-foreground">
  Action
</Button>
```

## Permissions and Access

- Theme editing is guarded by tenant settings permissions.

## Security and Compliance Notes

- No hardcoded colors in components; use tokens or CSS variables.
- Validate font and color input before applying.

## References

- `docs/modules/COMPONENT_GUIDE.md`
- `../../src/hooks/useTenantTheme.js`
