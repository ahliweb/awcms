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
  (`sql/176`), bukan kode handler. Rehire adalah employment baru setelah yang
  pertama diakhiri.
- **Terms hanya-tambah dan berlaku-efektif.** Perubahan menutup baris terbuka dan
  menyisipkan yang berikutnya; terms tidak pernah tumpang tindih; `terminated`
  bersifat terminal dan menandai header; rantai atasan tidak siklik dan paling
  dalam sepuluh sisi, dihitung termasuk bawahan di bawah seorang karyawan (satu
  fungsi SQL yang dipakai trigger dan pra-cek handler). Penulisan sisi atasan
  mengambil satu advisory lock per tenant, sehingga dua sisi bersamaan yang
  menutup siklik tidak bisa sama-sama commit. Masing-masing adalah trigger, sehingga sesi yang melewati
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

## Butir terbuka dan postur fase 1 yang tercatat

Terbuka (dilacak, tidak disembunyikan):

- **Terms belum di-join ke ekspor subjek.** `awcms_hr_employment_terms` bernilai
  `exportable: false` karena deskriptor subjek tidak bisa menyatakan join
  `employment_id` ke seseorang. Ekspor akses-subjek saat ini hanya membawa header
  employment; karyawan membaca terms-nya sendiri lewat
  `GET /employments/{id}/terms`. Ini **butir terbuka**: join langsung
  employment-ke-subjek di ekspor harus mendarat sebelum modul keluar dari
  `experimental`.
- **Belum ada purge.** Deskriptor `data_lifecycle` menyatakan siklus yang
  dimaksud (soft delete, lalu purge setelah masa retensi pemberi kerja) tetapi
  belum ada yang mem-purge; archive-then-purge untuk baris HR adalah tindak lanjut.

Postur fase 1 yang diketahui (didokumentasikan, tanpa perubahan kode di PR ini):

- Pembacaan berlaku se-tenant bagi pemegang `employments.read`: belum ada
  pembatasan per kantor atau per atasan (skenario S4 dan S6 paket desain butuh
  adapter scope `office` dan alasan kepemilikan `manager_of`, keduanya issue
  berikutnya).
- Penautan login (`assign`) tidak memakai step-up dan tidak mendaftarkan aturan
  pemisahan tugas; ia berisiko tinggi, diaudit, dan idempoten, dan tenant dapat
  menyusun aturan SoD atasnya.
- Resolver kepemilikan membaca satu boolean tentang sebuah baris sebelum guard
  memutuskan (di dalam transaksi tenant, di bawah RLS); id yang tidak ada dan baris
  milik orang lain sama-sama dijawab 403, jadi bukan oracle keberadaan, tetapi
  pembacaan terjadi sebelum keputusan.

## Keterbatasan

- Belum ada layar admin; `experimental`.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill`
  untuk menerima permission yang di-seed (keterbatasan setiap seed permission).
- Nomor karyawan dan tanggal masuk tidak bisa disunting langsung (hapus lalu buat
  ulang selama itu kesalahan); endpoint sunting header adalah issue berikutnya.
- Tabel terms belum di-join ke ekspor subjek (lihat di atas).
- `btree_gist` tidak dipakai: tumpang tindih terms adalah trigger, bukan
  exclusion constraint.
