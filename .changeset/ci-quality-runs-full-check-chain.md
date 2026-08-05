---
"awcms": patch
---

CI job `quality` kini menjalankan `bun run check` PENUH alih-alih cermin manual per-step yang sempat kehilangan 16 dari 34 gerbang di PR (di antaranya `access:permissions:enforcement:check` dan `access:chokepoint:check` — keduanya tidak pernah jalan di CI PR sejak mendarat). Bentuk cermin manual mengulang persis pelajaran PR #770; guard paritasnya (`tests/family-conformance-ci-parity.test.ts`) kini mengikat bentuk struktural anti-drift: step `run: bun run check` ber-`DATABASE_URL: ""` (pola job Validate release.yml), bukan kehadiran satu gerbang bernama.
