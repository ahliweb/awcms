🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:528d5eb5b3a38d05e595c5eb4f2ae05c856b31838d40b2f4ede5d7cdc8a1b9d9 -->

# `hr_workforce`

**Konteks ketenagakerjaan** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.id.md), fase 1
keluarga `hr_*`). Paket desainnya adalah
[`docs/awcms/hr-payroll.id.md`](../../../docs/awcms/hr-payroll.id.md) bagian 2.1, 3,
dan 4.1; berkas ini adalah peta kodenya.

## Apa yang ada, dan apa yang belum

Ini adalah **fondasi**: employment, terms berlaku-efektif, settings, dan
karyawan-melihat-miliknya. **Belum ada:** kehadiran, koreksi, shift, port
ketersediaan staf, komisi, dan payroll (issue berikutnya di bawah ADR yang sama) —
dan **tidak akan pernah** ada field foto, biometrik, atau sidik-jari perangkat
(keputusan pemilik O6).

Status `experimental`: flag mati, belum ada layar admin, dan modul tidak
mendeklarasikan `navigation`. Ia menjadi `active` bersama layar pertamanya.

## Aturan yang membuatnya aman

- **Referensi, bukan salinan.** `awcms_hr_employments.profile_id` adalah foreign
  key komposit `(tenant_id, profile_id)` ke `awcms_profiles`. Tidak ada kolom nama,
  kontak, tanggal lahir, NIK, atau NPWP di tabel HR mana pun; tampilan membaca
  `profile_identity`. Sebuah tes memastikan kolom seperti itu tidak muncul.
- **Satu employment aktif per profil dan per login**, lewat partial unique index
  (`sql/180`), bukan kode handler. Rehire adalah employment baru setelah yang
  pertama diakhiri.
- **Terms hanya-tambah dan berlaku-efektif.** Perubahan menutup baris terbuka dan
  menyisipkan yang berikutnya; terms tidak pernah tumpang tindih; `terminated`
  bersifat terminal dan menandai header; rantai atasan tidak siklik dan paling
  dalam sepuluh tingkat. Masing-masing adalah trigger, sehingga sesi yang melewati
  aplikasi tidak bisa merusaknya.
- **Merge profil** antara dua profil yang sama-sama berstatus bekerja aktif
  ditolak oleh trigger pada `awcms_profiles` (ADR-0132 bagian 2).
- **Karyawan melihat miliknya** adalah `ownershipGrant` (ADR-0063) pada
  `tenant_user_id` yang tersimpan, dilewatkan lewat opsi `ownershipGrant` baru di
  `defineTenantRoute`. Ia hanya MELEBARKAN `employments.read`; ABAC deny, scope,
  dan SoD tetap berlaku, kredensial mesin tidak pernah membawanya, dan id yang
  tidak ada serta baris milik orang lain adalah 403 yang sama. Penautannya sendiri
  adalah `employments.assign`: berisiko tinggi dan diaudit.
- **Aksi berisiko tinggi** (`create`, perubahan terms, `assign`, `delete`,
  `restore`, `configure`) mewajibkan `Idempotency-Key` dan diaudit tanpa nama,
  jabatan, nomor, alasan, atau id akun.

## Keputusan hak subjek data (cakupan ADR-0094)

| Tabel                         | `subjectData`                                                    | Alasan                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `awcms_hr_employments`        | tercakup: `profile_id`, `tenant_user_id` + stempel; diekspor     | Catatan kepegawaian milik subjek sendiri. Dipertahankan di bawah kewajiban ketenagakerjaan/pajak/jaminan sosial pemberi kerja (`retain_under_obligation`); tautannya tetap dan mengarah ke profil yang sudah dianonimkan.                                                                                                                              |
| `awcms_hr_employment_terms`   | tercakup: hanya stempel aktor; **tidak diekspor**; dipertahankan | Mencapai orangnya hanya lewat `employment_id`, yang tidak bisa dinyatakan kolom subjek langsung. Subjek membaca riwayatnya sendiri lewat `GET .../terms` yang diberi hak kepemilikan. Hanya-tambah, sehingga penghapusan tidak bisa menulis ulangnya. Join employment-ke-subjek langsung di ekspor adalah tindak lanjut tercatat (lihat Keterbatasan). |
| `awcms_hr_workforce_settings` | `NO_SUBJECT_DATA` (alasan tercatat)                              | Baris konfigurasi tenant; hanya stempel `updated_by`.                                                                                                                                                                                                                                                                                                  |

Ketiga tabel didaftarkan ke `data_lifecycle` sebagai `delegated`, tanpa purge:
riwayat HR dipertahankan selama masa hukum pemberi kerja (menurut penasihat
hukum, tidak ditegaskan di sini); archive-then-purge untuk baris HR adalah tindak
lanjut tercatat.

## Tata letak

| Path                                        | Isinya                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `module.ts`                                 | Deskriptor: 8 permission, `dataLifecycle` + `subjectData`                           |
| `domain/hr-workforce-types.ts`              | Tipe dan status employment — murni                                                  |
| `domain/hr-workforce-validation.ts`         | Validator request ketat (tanpa field personal, tanpa tanggal akhir turunan) — murni |
| `domain/hr-workforce-permissions.ts`        | Objek guard literal yang diteruskan ke `authorizeInTransaction`                     |
| `application/hr-workforce-directory.ts`     | Seluruh SQL: list/get, buat, ubah terms, assign, delete/restore, settings           |
| `application/hr-workforce-route-support.ts` | Idempotensi, validasi body, dan dasar kepemilikan yang dipakai bersama oleh route   |
| `src/pages/api/v1/hr-workforce/**`          | 6 berkas route tipis, masing-masing otorisasi lewat `defineTenantRoute`             |

## Keterbatasan

- Belum ada layar admin; `experimental`.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill`
  untuk menerima permission yang di-seed (keterbatasan setiap seed permission).
- Nomor karyawan dan tanggal masuk tidak bisa disunting langsung (hapus lalu buat
  ulang selama itu kesalahan); endpoint sunting header adalah issue berikutnya.
- Tabel terms belum di-join ke ekspor subjek (lihat di atas).
- `btree_gist` tidak dipakai: tumpang tindih terms adalah trigger, bukan
  exclusion constraint.
