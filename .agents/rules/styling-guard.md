---
description: Enforce semantic CSS variables and prevent hardcoded color values in components
---

# Styling Guard

> **Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.4

## Rule

All components MUST use semantic TailwindCSS utility classes (`bg-primary`, `text-foreground`,
`border-muted`) or CSS custom properties (`var(--color-primary)`). Hardcoded color values are
**FORBIDDEN** in component code.

## Violations

The following patterns are violations:

```
❌ bg-[#123456]
❌ text-[#ff0000]
❌ style={{ color: '#abc123' }}
❌ border-[rgb(1,2,3)]
❌ fill="red"
```

## Allowed

```
✅ bg-primary
✅ text-foreground
✅ border-muted-foreground
✅ var(--color-accent)
✅ className={cn('bg-primary', props.className)}
```

## Enforcement

1. **Pre-commit / CI check**:

   ```bash
   grep -rn 'bg-\[#\|text-\[#\|border-\[#\|fill-\[#\|stroke-\[#' awcms/src/
   ```

   Must return 0 results.

2. **Code review gate**: Reject any PR introducing hardcoded hex, RGB, or HSL values in
   component files (`.jsx`, `.tsx`, `.js`, `.ts`, `.css` within `src/`).

3. **Exception**: Static asset files (SVG icons) may contain fill/stroke colors when those
   SVGs are not theme-aware. Document exceptions in the PR description.

## Rationale

- Enables white-labeling and per-tenant branding via CSS variable overrides
- Ensures dark mode works correctly without color-by-color patching
- Maintains visual consistency across the platform
