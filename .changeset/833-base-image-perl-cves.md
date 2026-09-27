---
"awcms": patch
---

fix(docker): apply Debian security upgrades in the `base` stage of `Dockerfile.production`

`oven/bun:1.4.2`'s Debian (trixie) base shipped `perl-base 5.40.1-6`, carrying three
CRITICAL, fixed-upstream CVEs (CVE-2026-13221, CVE-2026-42496, CVE-2026-8376 — fixed in
`5.40.1-6+deb13u1`). As of 2026-09-27 there is no newer `oven/bun` tag whose base already
carries the fix — `1.4.2`/`1`/`1.4`/`latest` share one digest published 2026-09-05, before
the fix existed, and `1.4.2-slim` carries the same three CVEs. `base` now runs
`apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*` before any other
layer, so every derived stage (`deps`, `build`, `prod-deps`, `jobs`, `runtime`) inherits
the fix, and any future fixable Debian CVE on this base is closed on the next rebuild
without waiting for `oven/bun` to republish the tag.

Release-pipeline / deployment-image concern only (`Dockerfile.production`, ADR-0001) — no
application code, API, or contract changed.
