---
"awcms": patch
---

chore(deps): license/SBOM gate, provider API changelog gate and idempotent issue filing for the weekly dependency run (Issue #1173). Tooling only: no schema, API, event or runtime behaviour change.

`bun run deps:license:check` parses `bun.lock` (Bun-only), reads each installed package's license, refuses anything outside `scripts/dependency-license-policy.ts` (reasoned, expiring exceptions; an exception that matches nothing is stale; an unreadable license is UNKNOWN, not clean) and writes a CycloneDX 1.6 SBOM with `--out-sbom`. `bun run deps:provider-changelog:check` holds `scripts/provider-api-register.ts` to the code in both directions (a pinned version that changed, a source file naming a provider host that nobody registered) and to a review clock. `bun run deps:issues:sync` files one issue per finding from the scheduled workflow, idempotently (a hidden fingerprint marker, a per-run cap, never edits or closes). Both gates are in `bun run check`; all three take `--root`/`--policy`/`--register` so a downstream workspace with a different lockfile root can reuse them. Documented in `docs/awcms/dependency-governance.md`.
