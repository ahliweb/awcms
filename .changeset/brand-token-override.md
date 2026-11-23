---
"awcms": minor
---

feat(ui): optional `brand/tokens.override.json` overrides the values of the `--color-primary*`, `--color-info*` and `--color-sidebar*` tokens without editing `src/styles/tokens.css` (#1355). It is appended to `tokens.css` at build time by a Vite transform, so it ships in the same external stylesheet (no inline style, CSP unchanged); unknown, non-allow-listed or non-hex entries fail the build with every problem listed; `design:token-contrast:check` measures the effective values, so a brand below WCAG 2.1 AA fails the check. With no file the output is unchanged. Documented in `docs/awcms/14_ui_ux_design_system.md`.
