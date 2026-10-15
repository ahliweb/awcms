---
"awcms": patch
---

chore(deps): bump astro from 7.3.5 to 7.3.8 and @astrojs/node from 11.1.6 to 11.1.7 together (#991, #992)

The two Dependabot PRs are applied as one change: they share `bun.lock` and the same four gates, so either alone left CI red.

- **Stack manifest.** `awcms-family-compatibility.yaml` (`stack.astro` -> `^7.3.8`, `stack.astroNode` -> `^11.1.7`) and the version table in `docs/awcms/family-compatibility.md` / `.id.md` move with `package.json`; `family:conformance:check` compares the declared values with `package.json` and failed on both PRs.
- **Client asset budget.** The `astro` 7.3.8 build re-minifies the same source differently: the net across app assets is +208 B (320,435 B -> 320,643 B), with files moving both ways. `APP_BUDGET_BYTES` in `scripts/client-asset-budget.ts` is raised to 320,643 B (no margin added) with the measurement documented beside it. This is what failed `bun run build` in the Quality, E2E smoke and minimum-supported jobs.
- **Lockfile.** Regenerated with `bun install`, not edited by hand.
