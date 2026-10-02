---
"awcms": patch
---

fix(deps): override transitive devalue (5.9.4) and undici (^8.10.2) to clear high-severity advisories

`deps:audit:check` started failing on `main` without any dependency change once
new high-severity advisories were published against the locked transitive
versions: `devalue@5.8.1` (via `astro`, GHSA-j22f-vq7h-c4qm, GHSA-mcm9-63f2-9j32,
GHSA-x5rw-q4pp-hg5g, fixed after 5.9.2) and `undici@8.10.0` (via `unifont`,
GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-vp8m-p9jh-q5pm, fixed in 8.10.2).
Both are closed through `overrides`, as the audit gate prescribes, staying
inside the ranges their dependents already declare (`astro` wants
`devalue@^5.8.1`, `unifont` wants `undici@^8.0.0`), so no major version moves.
