🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:8586f3c4d407cdc4bec17457788b615c9b8283977ee4b8ff14be356de891952f -->

# `hr_commission`

**Aturan komisi berversi** (Issue #950,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.id.md), fase 2
keluarga `hr_*`). Paket desainnya adalah
[`docs/awcms/hr-payroll.id.md`](../../../docs/awcms/hr-payroll.id.md) bagian 2.2 dan
6; berkas ini adalah peta kodenya.

## Apa yang ada, dan apa yang belum

Ini adalah **fondasi aturan**: `awcms_hr_commission_rules`, API draft / publish /
retire, dan **fungsi evaluasi yang murni**. **Belum ada:** buku besar akrual,
siklus persetujuannya (approve, release, pay, void), reversal, port event sumber,
dan event `awcms.hr.commission.*` (issue berikutnya di bawah ADR yang sama). Ini
**bukan komisi afiliasi** (hr-payroll.md 6.4) dan **tidak membawa aturan negara
atau yurisdiksi mana pun**: tenant menyusun aturannya sendiri.

Status `experimental`: flag mati, belum ada layar admin, dan modul tidak
mendeklarasikan `navigation`. Ia menjadi `active` bersama layar pertamanya.

## Aturan yang membuatnya aman

- **Aturan adalah konfigurasi.** Ia tidak merujuk employment, profil, atau orang
  mana pun; satu-satunya kolom berbentuk-orang adalah empat stempel aktor. Sebuah
  tes memastikan kolom personal, foto, biometrik, atau perangkat tidak muncul.
- **Versi published tidak dapat diubah, lewat trigger** (`sql/182`), bukan lewat
  kode handler: draft dapat diedit dan boleh menjadi `published` (atau `retired`,
  meninggalkannya); satu-satunya perubahan yang diizinkan pada baris published
  adalah pindah ke `retired`, dengan semua kolom lain identik byte demi byte; baris
  retired tidak pernah berubah. Identitas (`rule_key`, `version_no`) tidak pernah
  berubah di keadaan apa pun, dan tidak ada baris yang pernah dihapus (`awcms_app`
  tidak punya DELETE dan trigger menolaknya untuk semua orang).
- **Baris lahir sebagai draft** (trigger `BEFORE INSERT`): versi published hanya
  dapat berasal dari draft yang lolos pemeriksaan tumpang-tindih di jalannya.
  Draft boleh langsung menjadi `retired`; itu disengaja ("tinggalkan draft ini"),
  jadi baris retired tidak berarti pernah dipublikasikan (`published_at` yang
  menjawab).
- **Publish terikat pada apa yang dilihat peninjau, dan pada orang kedua.** Setiap
  aturan membawa `contentDigest` (SHA-256 atas kunci, versi, dan term yang dapat
  diedit). `PUT` dan `publish` wajib menyebut digest yang mereka dasarkan
  (`expectedContentDigest`); bila term berubah sejak itu, hasilnya `409
RULE_CHANGED` dan tidak ada yang ditulis, sehingga draft yang diedit antara
  "melihat" dan "mempublikasikan" tidak pernah terpublikasi tanpa terlihat dan dua
  editor tidak saling menimpa. Digest dari yang dipublikasikan masuk ke baris
  audit (tanpa rate atau jumlah). **Maker / checker:** siapa pun yang membuat atau
  terakhir mengedit draft tidak dapat mempublikasikannya (`403
PUBLISH_BY_AUTHOR_FORBIDDEN`) — kontrol yang diminta desain payroll untuk aturan
  payroll (hr-payroll.md PS-07), di sini untuk aturan komisi. Tenant satu-orang
  karena itu butuh login kedua untuk mempublikasikan.
- **Berlaku-efektif.** Jendela setengah-terbuka, `[effective_from, effective_to)`,
  `NULL` = tanpa akhir. Tidak ada dua versi **published** dari satu aturan yang
  tumpang-tindih; trigger mengambil advisory lock per-(tenant, aturan) sebelum
  memeriksa, sehingga dua publish serentak berurutan dan yang kedua ditolak
  (exclusion constraint butuh `btree_gist`, yang tidak diminta migrasi mana pun di
  sini). Versi retired tidak lagi dihitung. Handler mengambil lock yang sama dan
  memeriksa lebih dulu, sehingga penolakannya `409 RULE_WINDOW_OVERLAP` yang bersih
  dengan menyebut versi yang bentrok; trigger adalah penopangnya.
- **Penggantian.** Versi published tidak pernah diedit untuk memberi ruang, jadi
  penggantinya membutuhkan jendela pendahulu BERAKHIR di tempat ia mulai: isi
  `effectiveTo` saat menyusun pendahulu, atau retire-kan.
- **Aturan yang berlaku** untuk sebuah event adalah versi published yang jendelanya
  memuat tanggal event itu sendiri (`selectEffectiveRule`), tidak pernah `now()`.
- **Uang itu eksak.** Kolom `numeric`, masing-masing dengan CHECK `<> 'NaN'`
  eksplisit (`numeric` menerima NaN dan NaN lolos `>= 0`); API membawa setiap rate dan jumlah sebagai
  STRING desimal (angka JSON adalah 400 — ia sudah melewati float); evaluasi adalah
  aritmetika `bigint` dan membulatkan sekali, pada mode dan skala aturan
  (`half_up`, `half_down`, `half_even`, `up`, `down`, `ceiling`, `floor`; skala 0
  sampai 6), lalu menjepit ke batas bawah dan atas opsional (yang dijamin database
  tidak memuat desimal lebih banyak dari skala).
- **Hasil terbatas.** Hasil kali dua input dalam-rentang belum tentu dalam-rentang
  (`999999999999.999999` x 1.000.000 unit adalah 10^18), sehingga
  `evaluateCommission` menolak hasil yang sudah dibulatkan sebesar 10^12 atau lebih
  (kapasitas bilangan bulat `numeric(18, 6)`) alih-alih memotongnya; diuji di
  batasnya (`999999.999999` x 1.000.000 lolos, `1000000` x 1.000.000 ditolak).
- **Evaluasi terbatas.** Aturan adalah rekaman tertutup, `percent` (persentase dari
  jumlah dasar, 0 sampai 100) atau `fixed` (jumlah per unit utuh, paling banyak
  1.000.000 unit): tidak ada ekspresi, skrip, callback, atau daftar tier yang bisa
  tak terbatas.
- **Publish dan retire berisiko tinggi**, dapat diberikan terpisah, mewajibkan
  `Idempotency-Key` (replay mengembalikan respons tersimpan; permintaan berbeda di
  bawah kunci yang sama adalah 409) dan diaudit pada `warning`. Tidak ada baris
  audit yang memuat rate, jumlah, atau nama aturan — hanya kunci, versi, dan jendela.
- **Setiap handler memberi otorisasi lewat `authorizeInTransaction`** (melalui
  `defineTenantRoute`), dan lima permission di-seed oleh `sql/183`; sebuah tes
  membuktikan tiap guard menggigit (memegang semua permission lain ditolak,
  memegang hanya itu berhasil).

## Peta

| Berkas                                        | Isi                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `module.ts`                                   | Descriptor, permission, `dataLifecycle`, dan `subjectData`                  |
| `domain/hr-commission-decimal.ts`             | Parsing, pembulatan, dan format desimal `bigint` yang eksak                 |
| `domain/hr-commission-evaluation.ts`          | `evaluateCommission` dan `selectEffectiveRule` yang MURNI                   |
| `domain/hr-commission-validation.ts`          | Validator request yang ketat (uang sebagai string)                          |
| `domain/hr-commission-permissions.ts`         | Guard, sebagai objek literal                                                |
| `application/hr-commission-rule-directory.ts` | List, get, create, edit draft, publish, retire (outcome, audit)             |
| `application/hr-commission-route-support.ts`  | Idempotency, parsing body, dan helper id yang dipakai bersama route         |
| `src/pages/api/v1/hr-commission/rules/**`     | 4 berkas route tipis (`/rules`, `/rules/{id}`, `.../publish`, `.../retire`) |

## Item terbuka dan postur tercatat

- **Evaluasi tidak punya endpoint HTTP.** Ia dipakai issue akrual berikutnya;
  endpoint dry-run tidak dibuka.
- **Helper desimal adalah salinan kecil** dari gagasan di `tax/domain/decimal.ts`,
  karena modul ini tidak mendeklarasikan dependensi ke `tax`. Mengangkat keduanya
  ke `_shared` adalah tindak lanjut.
- **`occurredOn` adalah tanggal.** Jendela adalah tanggal, bukan instan; pemanggil
  menurunkan tanggal event (dalam waktu sipil apa pun yang dipakai tenant-nya)
  sebelum memilih aturan. Tidak ada zona waktu yang diasumsikan di sini.
- **Disimpan tanpa batas waktu, tanpa periode yang diklaim.** Sengaja tidak ada
  descriptor `dataLifecycle` (ia harus mengklaim periode retensi): tabel dijawab
  oleh entri `BOUNDED_BY_DESIGN` di
  `scripts/data-lifecycle-table-coverage-check.ts`. Periode untuk syarat komersial
  yang dikutip akrual nanti adalah milik penasihat hukum tenant dan tidak ada
  pemiliknya di sini; arsip-lalu-purge untuk baris HR adalah tindak lanjut
  (hr-payroll.md bagian 15).
- **Mempublikasikan jendela berlaku-surut TIDAK digerbangi khusus.** Di luar
  cakupan fase ini dan ditunda ke issue akrual: belum ada buku besar yang memakai
  aturan, sehingga `effectiveFrom` di masa lalu tidak mengubah apa pun yang ada.
  Saat akrual mendarat, publish yang jendelanya dimulai di masa lalu membutuhkan
  flag eksplisit dan alasan (berisiko tinggi, diaudit), karena ia dapat diam-diam
  mengubah aturan mana yang berlaku untuk event yang sudah terjadi.
- **Descriptor subjek hanya stempel aktor** dan `exportable: false`: sebuah aturan
  tidak menamai subjek data.

## Keterbatasan

- Tanpa layar admin; `experimental`.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill` untuk
  menerima permission yang di-seed (keterbatasan yang dibawa setiap seed permission).
- Draft hanya dapat diubah dengan mengganti seluruh field yang dapat diedit (`PUT`);
  tidak ada edit parsial dan tidak ada helper "salin dari versi sebelumnya".
- `btree_gist` tidak dipakai: tumpang-tindih adalah trigger, bukan exclusion constraint.
