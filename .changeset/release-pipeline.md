---
"awcms": minor
---

Implementasikan pipeline release nyata (docs/awcms/release-process.md): `Dockerfile.production` (multi-stage, non-root, health check), `.dockerignore`, `scripts/release-verify.ts` (+ `scripts/lib/release-verify-checks.ts`, tag == package.json version, CHANGELOG punya section, tak ada changeset pending), dan `.github/workflows/release.yml` (validate → build image + SBOM ganda → keyless cosign sign + provenance/SBOM attest → publish GitHub Release, dengan jalur rehearsal via `workflow_dispatch`). Belum pernah dieksekusi terhadap tag nyata — rehearsal pertama masih perlu dijalankan sebelum tag `v5.0.0` sungguhan di-push.
