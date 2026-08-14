---
"awcms": patch
---

fix(admin-ui): the theme toggle was inert in production, and now a gate reads the build instead of the comment

`ThemeToggle.astro` carried a doc comment asserting that its `<script>`, having
no `is:inline`, would be bundled to an external module and therefore need no CSP
hash bookkeeping. The built manifest disagreed. `dist/server/entry.mjs` listed
`src/components/ThemeToggle.astro` in `inlinedScripts`, Astro's `renderScript`
emitted it as `<script type="module">…</script>`, and the production CSP —
verified live as `script-src 'self' 'sha256-lOc2GAiS/8scFxSOam/Qp0WAZJ9iWtVPpAe0h4d3eDE='`
— refused it. The button rendered and did nothing.

The mechanism is the same one that cost v9.1.2, and this is its **third**
instance:

1. `LanguageSwitcher` — shipped, found in production.
2. The first attempted fix for it — a bare side-effect import into a module
   nothing else used, which folded into the script and inlined identically.
3. `ThemeToggle` — this one, sitting in the build for weeks.

Astro emits an external file only when something survives bundling that needs a
CROSS-CHUNK import. This script's one import was `THEME_STORAGE_KEY`, a string
constant; the minifier folds it to a literal, the import disappears, nothing is
left that needs a chunk. "Has an import" was true in the source and false in the
artefact — which is exactly why a comment cannot be the control.

So the control is now the artefact. `build:inline-scripts:check` reads the built
SSR manifest and fails if ANY component script is inlined. The bound is **zero**,
not "at most one": the hash-authorised theme-init body is `is:inline` and never
passes through that map, so zero is both correct and the only bound with no
allow-list to quietly widen. It runs as part of `bun run build`, so it also
covers `release.yml`, which builds without running the full `check` chain.

Proven against the real defect rather than a synthetic one: run on the build that
shipped, it names `ThemeToggle.astro`; run after the fix, it passes.

The fix itself follows the pattern `AdminLayout.astro` already documents — the
behaviour moves to `src/lib/ui/theme-toggle-client.ts` and is imported from the
layout's script alongside the imports already proven external. That also means
this code is now type-checked, which a `.astro` `<script>` never is.
