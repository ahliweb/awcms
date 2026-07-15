<!-- Terima kasih atas kontribusinya. Isi bagian yang relevan; hapus yang tidak. -->

## Ringkasan

<!-- Apa yang diubah dan mengapa. Kaitkan issue: Closes #NNN -->

Closes #

## Jenis perubahan

- [ ] `feat` — fitur baru
- [ ] `fix` — perbaikan bug
- [ ] `docs` — dokumentasi
- [ ] `refactor` / `perf` / `chore`
- [ ] `security` — terkait keamanan
- [ ] `ci` / `build`

## Checklist (Definition of Done)

- [ ] Scope sesuai issue, tidak ada perubahan unrelated (atomic).
- [ ] Migration ditambahkan bila schema berubah (`NNN_awcms_*.sql`, tanpa `BEGIN/COMMIT`).
- [ ] OpenAPI diperbarui bila API berubah; AsyncAPI diperbarui bila event berubah (`api:spec:check` lolos).
- [ ] Mutation high-risk memakai `Idempotency-Key`.
- [ ] Data tenant-scoped memakai tenant context + ABAC (default deny) + RLS.
- [ ] Aksi high-risk menulis audit; data sensitif dimask/redact.
- [ ] Soft delete diterapkan untuk resource deletable; data posted tetap immutable.
- [ ] Test relevan lulus; `bun run build` lulus (bila menyentuh kode).
- [ ] Dokumentasi diperbarui.
- [ ] Bila PR ini menambah/mengubah kategori modul (Core/System/Official Optional Module) atau provider eksternal baru: sudah mengikuti `docs/awcms/21_module_admission_governance.md` + `docs/awcms/templates/module-admission-decision-checklist.md`.
- [ ] Changeset ditambahkan bila perubahan mempengaruhi perilaku (`bun run changeset`).
- [ ] **Tidak ada** secret, kredensial, dump DB, atau data pengguna asli dalam diff.

## Validasi yang dijalankan

<!-- Perintah + hasil ringkas. Contoh: `bun test` (xx pass), `bun run api:spec:check` (OK) -->

```text

```

## Catatan keamanan

<!-- Dampak keamanan, atau "tidak ada". Untuk kerentanan JANGAN pakai PR/issue publik — lihat SECURITY.md -->

## Catatan untuk reviewer

<!-- Area yang perlu perhatian khusus, trade-off, atau follow-up -->
