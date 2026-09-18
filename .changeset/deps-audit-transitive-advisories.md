---
"awcms": patch
---

fix(deps): close three high-severity transitive advisories flagged by `bun run deps:audit:check`

Bumped `overrides` (package.json) — pre-existing drift unrelated to any feature in this release, caught only because `bun run check`'s `deps:audit:check` gate is run on every PR:

- `js-yaml` `^4.3.1` → `^4.3.2` — [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) (`maxTotalMergeKeys` does not limit CPU use for empty merge sources).
- `smol-toml` (new override) `^1.7.1` — [GHSA-7w5x-hrqm-74c2](https://github.com/advisories/GHSA-7w5x-hrqm-74c2) (denial of service via malformed TOML documents, `<=1.7.0`).
- `svgo` (new override) `^4.1.0` — [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r) (`removeScripts` allows executable links through namespace and control-character bypasses, `>=4.0.0 <4.1.0`).

The `svgo` bump pulls `css-select` (`5.2.2` → `6.0.0`) and `css-what` (`6.2.2` → `7.0.0`) transitively across a MAJOR version each — both are build-time-only dependencies of `astro`'s asset pipeline, not runtime dependencies of this application, and `bun run build` passed unchanged after the bump (verified locally and in CI on this PR).
