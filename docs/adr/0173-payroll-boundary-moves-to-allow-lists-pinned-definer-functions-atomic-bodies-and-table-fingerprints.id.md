🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0173-payroll-boundary-moves-to-allow-lists-pinned-definer-functions-atomic-bodies-and-table-fingerprints.md)

<!-- i18n-source-hash: sha256:3eb27e7eb4eeb680b5647b0d0c56e8640a6c7f12c3c7a4f0bbb84081fffe17d8 -->

# ADR-0173 — Batas payroll pindah ke allow-list: fungsi SECURITY DEFINER yang dipatok, badan atomik yang dibaca, tabel bersidik jari

- **Status:** Diusulkan
- **Tinjauan:** arahnya diterima pemilik pada 2026-11-22 (keputusan K3 dari #1095). Aturan di bawah sudah diimplementasikan dan ditegakkan, karena masing-masing hanya membuat pemeriksaan katalog lebih ketat dan allow-list-nya dikirim kosong. Yang masih memerlukan pemilik adalah tata kelola allow-list: siapa yang boleh menambah entri (Q1) dan seberapa luas "jangkauan" (Q2). Sampai saat itu, jawaban yang direkomendasikan adalah yang dikerjakan kode.
- **Tanggal:** 2026-11-24
- **Pengambil keputusan:** @ahliweb (diusulkan, Q1 dan Q2 belum diputuskan)
- **Terkait:** Issue [#1436](https://github.com/ahliweb/awcms/issues/1436) (ADR ini), [#1095](https://github.com/ahliweb/awcms/issues/1095) (residu 1 sampai 7, pemeriksaan katalog terjadwal), [#1077](https://github.com/ahliweb/awcms/issues/1077) dan [#1015](https://github.com/ahliweb/awcms/issues/1015) (lapisan katalog); [ADR-0132](0132-hr-payroll-module-family-admission.id.md) (keluarga payroll), [ADR-0147](0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.id.md); `src/modules/_shared/payroll-data-boundary.ts`, `scripts/lib/payroll-catalog-boundary.ts`, [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.id.md) bagian 13.3.

## Konteks

Batas data payroll punya dua lapisan. Lapisan statis membaca teks migrasi; lapisan katalog membaca `pg_catalog` database yang sudah dimigrasi (CI, rilis, dan harian terhadap database yang dideploi sebagai `payroll:catalog-boundary:job`). Keduanya **deny-list**: mencari nama payroll, row type payroll, `EXECUTE` dinamis, helper yang membaca relasi lewat string, lalu menolak yang ditemukan. #1095 meninggalkan tujuh residu "dipersempit, tidak ditutup". Tiga di antaranya berakar sama: pemeriksaan berusaha membuktikan sesuatu tidak berbahaya, dan penulis yang gigih selalu dapat membangun sesuatu yang tidak dimodelkan pembuktian itu.

1. **SECURITY DEFINER di luar keluarga.** Fungsi `SECURITY DEFINER` non-keluarga berjalan dengan hak pemiliknya. Bila pemiliknya dapat membaca payroll, fungsinya pun dapat, dan pemindaian memutuskan dengan membaca badannya. Badan yang tidak menyebut apa pun (string yang dirakit di tempat lain, helper yang belum masuk daftar) lolos.
2. **Badan standar SQL.** Badan `BEGIN ATOMIC` (atau `RETURN expr`) disimpan dalam bentuk ter-parse di `prosqlbody`; `prosrc`-nya kosong. Lapisan katalog membaca `prosrc`, sehingga setiap aturan badan melihat string kosong. Hanya dependensi relasi di `pg_depend` yang terbaca; panggilan ke fungsi keluarga payroll atau ke fungsi bocor lain tidak.
3. **Tabel wajib dikenali dari nama.** Katalog memastikan tabel wajib ada dengan namanya, membawa penanda dan trigger-nya, dan tidak ada relasi lain yang berbagi 70% kolomnya (nama dan tipe sama). Pembangunan ulang yang mengganti nama lebih dari 30% kolom, atau trigger wajib yang dibuat ulang dengan namanya sendiri tetapi fungsi lain atau event lebih sedikit, lolos.

## Keputusan

Ketiganya diganti dengan **allow-list**: pemeriksaan tidak lagi membuktikan sesuatu tidak berbahaya, melainkan mewajibkan hal itu menjadi entri yang ditinjau dan dipatok.

### 1. Fungsi SECURITY DEFINER non-keluarga dalam jangkauan payroll masuk allow-list

Fungsi `SECURITY DEFINER` non-keluarga **dalam jangkauan** bila pemiliknya, langsung atau lewat keanggotaan role (transitif, `NOINHERIT` tidak dimodelkan, jadi fail-closed), adalah salah satu dari: pemilik relasi payroll atau fungsi keluarga; pemilik ledger migrasi; role di `PAYROLL_EXPECTED_OWNERS`; penerima grant pada relasi payroll; penerima EXECUTE atas fungsi `SECURITY DEFINER` keluarga (`PUBLIC` di sana membuat setiap pemilik masuk jangkauan); `pg_read_all_data`, `pg_write_all_data`, `pg_maintain`; superuser atau role `BYPASSRLS`.

Fungsi seperti itu adalah temuan (`security-definer-not-allow-listed`) kecuali menjadi entri `PAYROLL_SECURITY_DEFINER_ALLOWLIST`:

```ts
"public.awcms_x_fn(p_tenant_id uuid)": {
  reason: "mengapa butuh hak yang menjangkau payroll (40+ karakter)",
  approvedIn: "#NNNN",          // atau "ADR-NNNN"
  owner: "awcms_x_owner",       // tidak pernah awcms_app atau awcms_worker
  bodySha256: "<64 hex>"        // SHA-256 badan yang dikembalikan katalog
}
```

- **Bentuk.** Kuncinya `schema.name(identity arguments)` persis seperti dicetak `pg_get_function_identity_arguments`, jadi overload adalah entri terpisah. Entri **mematok** objek yang ditinjau: pemilik atau badan yang berubah adalah `security-definer-allowlist-drift`; kunci yang fungsinya hilang, atau tidak lagi `SECURITY DEFINER`, dilaporkan basi dan menggagalkan pemeriksaan. Registri divalidasi saat dimuat (bentuk kunci, alasan, rujukan tinjauan, pemilik bukan role runtime, bentuk digest) dan tinggal di berkas batas di samping registri payroll lain.
- **Satu-satunya jalur.** `PAYROLL_CATALOG_EXEMPTIONS` tidak membungkam aturan ini maupun dua aturan di bawah; pengecualian berkata "objek ini boleh membaca payroll", entri allow-list berkata "badan persis ini, milik role ini, sudah ditinjau".
- **Jalan keluar yang tidak butuh entri** adalah konvensi repo yang sudah ada: miliki fungsinya dengan role `NOLOGIN` khusus yang tidak memegang hak payroll apa pun. Ke-26 fungsi `SECURITY DEFINER` non-keluarga di `sql/` hari ini semuanya begitu, jadi allow-list dikirim **kosong** dan tidak ada yang membutuhkannya di katalog termigrasi.

### 2. Badan standar SQL dianalisis seperti badan lain

Pemuat katalog membaca `pg_get_function_sqlbody(oid)` bila `prosqlbody` terisi, dan mencatat edge `pg_depend` fungsi itu ke fungsi lain. Edge yang tercatat dihitung sebagai panggilan, untuk aturan panggilan-keluarga dan untuk rantai transitif. Badan standar SQL yang kembali kosong gagal tertutup (`function-body-unreadable`). Lapisan statis memang sudah memindai badan seperti itu sebagai teks; ia tidak berubah.

### 3. Tabel payroll wajib dipatok oleh sidik jari

`PAYROLL_REQUIRED_TABLE_FINGERPRINTS` menyimpan, per tabel wajib: setiap kolom sebagai `name:type`; setiap trigger wajib dengan fungsi dan bitmask `tgtype`-nya; setiap foreign key dengan target dan kolom perujuknya; dan `nameFreeTolerance`.

- **Drift** (`payroll-fingerprint-drift`): tabel dengan nama keluarganya berbeda dari sidik jarinya. Migrasi yang mengubah tabel wajib memperbarui sidik jari di PR yang sama, persis seperti `PAYROLL_REQUIRED_TABLES` diperbarui hari ini. `PAYROLL_REQUIRED_TRIGGERS` dan `PAYROLL_REQUIRED_FOREIGN_KEYS` kini diturunkan dari sidik jari, jadi hanya ada satu daftar.
- **Cocok** (`payroll-fingerprint-match`): relasi non-keluarga yang **tipe** kolomnya (multiset, nama diabaikan) berada dalam `nameFreeTolerance` sebuah sidik jari adalah tabel itu dengan nama lain. Toleransi ledger adalah 3; relasi biasa terdekat di katalog termigrasi berjarak 7, dan tes integrasi menjaga marginnya di atas dua kali toleransi, sehingga modul baru yang tabelnya terlalu dekat menggagalkan CI dan toleransinya ditinjau ulang dalam review, bukan diam-diam.
- Log transisi **tidak** punya toleransi tanpa-nama (`null`): sembilan kolom generiknya hanya berjarak satu kolom dari log status biasa. Ia tetap dijaga oleh foreign key-nya ke ledger (`dependent-on-payroll`), trigger-nya, dan aturan tiruan 70% yang dipertahankan.

## Yang tidak diubah

- Review setiap perubahan `sql/` yang menyentuh payroll tetap kontrol utama; ini membuat pemeriksaan katalog lebih ketat, bukan menjadikannya pembuktian.
- Pembangunan ulang yang mengubah tipe kolom melebihi toleransi, atau salinan log transisi dengan nama lain tanpa foreign key-nya, masih hanya terdeteksi oleh heuristik yang tersisa. Slot replikasi logis, objek ekstensi, dan superuser tetap di luar, seperti sebelumnya.
- Tidak ada migrasi, API, event, atau role baru. Pemeriksaan berjalan di tempat yang sudah ada.

## Pertanyaan terbuka untuk pemilik

**Q1. Siapa yang boleh menambah entri ke `PAYROLL_SECURITY_DEFINER_ALLOWLIST`?**

- (A) **Direkomendasikan.** PR apa pun, disetujui satu maintainer di bawah security review yang sudah diwajibkan GOVERNANCE.md bagian "Pengambilan keputusan" butir 3 untuk perubahan keamanan; entri menyebut issue di `approvedIn`, dan badan PR menampilkan definisi fungsinya serta alasan role pemilik khusus tidak memungkinkan. Bobotnya sama dengan `PAYROLL_CATALOG_EXEMPTIONS` hari ini.
- (B) Setiap entri butuh ADR sendiri (atau amandemen ADR ini) dan dua maintainer (GOVERNANCE.md butir 2). Lebih kuat, lebih lambat; layak bila entri diharapkan cukup langka untuk bersifat arsitektural.
- (C) Seperti (A), ditambah baris CODEOWNERS untuk `src/modules/_shared/payroll-data-boundary.ts` yang menyebut peninjau keamanan selain penulis, begitu handle sungguhan menggantikan org placeholder.

**Q2. Seberapa luas "jangkauan"?**

- (A) **Direkomendasikan, sudah diimplementasikan.** Jangkauan berbasis pemilik seperti didefinisikan di Keputusan 1. Fungsi `SECURITY DEFINER` non-keluarga milik role tanpa hak payroll tidak dicatat: ia tidak dapat membaca payroll apa pun isi badannya, dan grant berikutnya ke role itu sendiri sudah menjadi temuan `payroll-grant`.
- (B) Setiap fungsi `SECURITY DEFINER` non-keluarga wajib dicatat, dalam jangkauan atau tidak. Lebih mudah dijelaskan; daftarnya akan dimulai dengan 26 entri yang tidak melindungi apa pun terkait payroll, dan setiap fungsi definer baru di modul mana pun akan menyentuh registri payroll.

## Konsekuensi

- Migrasi yang menambah fungsi `SECURITY DEFINER` milik role migrasi (bawaan bila tidak diikuti `ALTER FUNCTION ... OWNER TO`) kini menggagalkan pemeriksaan katalog di CI. Perbaikannya adalah konvensi yang sudah ada: role pemilik khusus.
- Migrasi yang mengubah kolom, trigger, atau foreign key tabel payroll wajib harus memperbarui `PAYROLL_REQUIRED_TABLE_FINGERPRINTS` di PR yang sama.
- Job harian melaporkan kode-kode baru seperti temuan lain; tidak perlu tindakan operator.

## Bukti

Setiap aturan baru dibuktikan dengan mutasi: tiap kontrol dirusak di penganalisis, dan tes unit serta tes integrasi terhadap katalog termigrasi memerah (angka di PR #1436). Probe baru di `tests/fixtures/payroll-boundary-probes.ts` (`adr0173-*`) dan blok "ADR-0173 allow-lists" di `tests/integration/payroll-catalog-boundary.integration.test.ts`; tes unit di `tests/payroll-allow-lists-1436.test.ts`.
