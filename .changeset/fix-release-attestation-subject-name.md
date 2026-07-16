---
"awcms": patch
---

Perbaiki `release.yml`'s job `sign-attest-publish`: `actions/attest-build-provenance` dan `actions/attest-sbom` menolak `subject-name` yang menyertakan tag (`ghcr.io/ahliweb/awcms:dryrun-<sha>@sha256:...` → `Invalid image name`) — ditemukan lewat rehearsal pertama (`workflow_dispatch`, run 29477950931) sebelum tag rilis nyata pertama di-push. Tambah output job `build`'s `image-repo` (repo tanpa tag) dan pakai itu untuk `subject-name` kedua step attest, sambil tetap memakai `image-ref` (dengan tag) untuk `cosign sign`.
