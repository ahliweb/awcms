---
"awcms": patch
---

chore(deps-dev): bump prettier from 3.9.6 to 3.9.9

Dev-only formatter behind `bun run lint`'s `prettier --check` gate and
`prettier-plugin-astro`. Verified locally with `bun install --frozen-lockfile && bun
run check`: `prettier --check` on the full `**/*.md`, `**/*.{json,yml,yaml}`, and
`**/*.{ts,mjs,astro}` glob stays clean, so `3.9.9` reformats nothing this repo already
has checked in.
