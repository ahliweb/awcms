# ADR-0072 — Retensi log keputusan otorisasi, dan siapa yang otoritatif setelahnya

- **Status:** Accepted
- **Tanggal:** 2026-08-09
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #427 (Gelombang 0 dari #423), [`../awcms/program-model-keanggotaan-2026-08-09.md`](../awcms/program-model-keanggotaan-2026-08-09.md), [ADR-0037](0037-data-lifecycle-module-admission.md) (mesin retensi + legal hold), [ADR-0033](0033-abac-dynamic-policy-evaluator.md) (yang menulis barisnya), [ADR-0049](0049-machine-credentials-and-session-introspection.md) §6 (apa yang SENGAJA tidak dicatat)

## Konteks

### 1. Tabel tanpa batas terbesar di repo

`awcms_abac_decision_logs` (`sql/005`) menerima satu baris untuk **setiap**
keputusan otorisasi — izin maupun tolak, di setiap jalur terminal
`authorizeInTransaction`. Pada 100 req/s itu ±8,6 juta baris/hari.

Ia **tidak punya retensi apa pun**. Saya menghitung ulang seluruh deskriptor
`dataLifecycle` di repo — `logging.audit_events`, `form_drafts.*`,
`data_lifecycle.data_lifecycle_runs`, event penyalahgunaan `comments`,
`identity_access.password_reset_tokens`, log query `site_search`,
`visitor_analytics.visit_events`, dan not-found `seo` — dan tabel ini tidak ada
di antaranya.

Yang membuatnya berbeda dari tabel besar lain: ia tumbuh sebanding dengan
**lalu lintas**, bukan dengan data pelanggan. Sebuah tenant yang tidak menambah
satu pun baris konten tetap menambah baris di sini setiap kali stafnya membuka
sebuah layar. Dan ia juga tabel yang paling dibutuhkan saat insiden — persis
ketika query terhadapnya paling lambat.

### 2. Job purge-nya, kalau ditulis hari ini, akan menghapus nol baris

`sql/022:177` memberi `awcms_worker` hanya `SELECT` atas tabel ini. Executor
generik `data_lifecycle` berjalan sebagai `awcms_worker`. Tanpa `GRANT DELETE`,
purge-nya berjalan, melapor sukses, dan tidak menghapus apa pun.

Kegagalan itu tidak berbunyi seperti kegagalan. Ia berbunyi seperti "tidak ada
yang perlu dihapus".

### 3. Sengketa yang lahir bersama retensinya

Modul `reporting` memakai tabel ini sebagai sumber cursor proyeksi
`access_audit_summary`, dan deskripsi sumbernya berbunyi:

> append-only — every decision is logged once and **never updated/deleted**, the
> ideal `cursor_table` source

Menambahkan retensi **membatalkan klaim itu**, dan akibatnya bukan kosmetik.
Proyeksinya punya dua jalur:

- **inkremental** — akumulasi maju lewat cursor, tidak pernah dihitung ulang;
- **rebuild** — dihitung ulang dari baris yang **masih ada**.

Setelah purge pertama, keduanya berselisih. Operator yang menekan rebuild akan
diam-diam **menghancurkan** hitungan historis dan menggantinya dengan hitungan
yang lebih kecil, tanpa satu pun error.

Jadi retensi dan otoritas proyeksi adalah **satu** keputusan. Memutuskan yang
pertama tanpa yang kedua menghasilkan dua angka untuk satu pertanyaan, dan tidak
ada yang tahu mana yang benar.

### 4. Satu klaim di rancangan awal ternyata salah

Issue #427 mengusulkan index `(tenant_id, created_at)` **menaik**, karena
`archive-purge-job.ts` memindai `ORDER BY <cursor> ASC` sementara index yang ada
(`sql/005`) menurun.

Diperiksa sebelum ditulis: **btree PostgreSQL bisa dipindai mundur**. Index
`(tenant_id, created_at DESC)` sudah melayani
`WHERE tenant_id = $1 AND created_at < $2 ORDER BY created_at ASC` tanpa sort
tambahan. Index kedua hanya akan menambah beban tulis pada tabel yang **paling
sering ditulis di seluruh repo** — trade yang salah arah, dibeli untuk apa-apa.

## Keputusan

Kami memutuskan untuk:

**A. Memberi `awcms_worker` hak `DELETE`** atas `awcms_abac_decision_logs`
(`sql/091`), dan **tidak** menambah index baru. Header migrasinya memuat alasan
§4 supaya usulan index itu tidak lahir kembali.

**B. Mendaftarkan deskriptor `identity_access.abac_decision_logs`** dengan
`retentionClass: "audit_security"`, `executionMode: "generic"`, `hard_delete`,
`legalHold.precedence: "overrides_retention"`, dan `partition.eligible: true`
(bulanan, **tidak** diotomasi — mendeklarasikan kelayakan adalah pernyataan
tentang tabelnya, bukan janji bahwa partisinya ada).

**C. Menetapkan jendela default 365 hari, bukan 90.** Angka itu **tidak** dipilih
demi penyimpanan. Ia adalah horizon di mana proyeksi `access_audit_summary` masih
bisa di-_rebuild_. Jendela yang lebih pendek akan diam-diam mempersempit apa yang
bisa direkonstruksi sebuah rebuild — yaitu kopling di §3, disembunyikan di balik
sebuah angka alih-alih dinyatakan.

**D. Menyatakan otoritasnya secara eksplisit, dan menuliskannya di artefak yang
akan dibaca orang berikutnya**, bukan hanya di ADR ini:

- Penghitung **inkremental** otoritatif untuk sepanjang-masa. Ia tidak
  terpengaruh purge dan tidak pernah dihitung ulang.
- Sebuah **rebuild** otoritatif untuk "sejak horizon retensi". Setelah purge
  pertama ia **sah** lebih kecil dari angka inkremental.

Deskripsi sumber proyeksi di `reporting/module.ts` diperbaiki untuk berhenti
mengklaim `never updated/deleted` dan menyatakan kopling itu di tempat seorang
implementor akan membacanya.

**E. Menegakkan kejujuran kedua artefak itu terhadap satu sama lain lewat test
dua arah**, bukan lewat kebiasaan review: begitu tabel ini punya deskriptor
lifecycle, deskripsi proyeksinya tidak boleh lagi mengklaim baris tak pernah
dihapus, dan wajib menyebut koplingnya.

## Konsekuensi

- **Positif:** tabel tanpa batas terbesar di repo mendapat batas; job purge-nya
  benar-benar bisa menghapus; legal hold berlaku atasnya; dan sengketa
  inkremental-vs-rebuild menjadi fakta tertulis alih-alih kejutan saat seseorang
  menekan rebuild.
- **Negatif / trade-off:** dua angka untuk satu pertanyaan tetap ADA — kami
  memilih menamainya, bukan menghapus salah satunya. Menghapus jalur rebuild akan
  membuang alat perbaikan; menghentikan akumulasi inkremental akan membuang
  jawaban sepanjang-masa. Yang bisa dilakukan ADR ini adalah memastikan keduanya
  punya nama dan cakupan.
- **Netral:** retensi tidak berlaku sampai `bun run data-lifecycle:archive-purge`
  benar-benar dijadwalkan — pelajaran yang sama sudah tercatat untuk
  `AUDIT_LOG_RETENTION_DAYS` (Issue #146). Deskriptor tanpa jadwal adalah niat,
  bukan retensi.
- **Netral:** memulihkan backup yang lebih tua dari jendela retensi menghidupkan
  kembali baris yang sudah dipurge. Tidak berbahaya untuk otorisasi — tidak ada
  apa pun yang membaca tabel ini untuk memutuskan sesuatu — tetapi rebuild
  setelahnya bisa menjangkau lebih jauh daripada basis data hidup.

## Alternatif yang dipertimbangkan

- **Jendela 90 hari** — angka pertama yang diusulkan issue-nya. Ditolak karena ia
  memilih angka yang menyembunyikan kopling §3 alih-alih menghadapinya: rebuild
  akan berhenti bermakna setelah satu kuartal tanpa ada yang menyatakannya.
- **Mengecualikan tabel ini dari retensi karena `reporting` bergantung padanya**
  — status quo. Ditolak: ia membiarkan tabel terbesar tumbuh selamanya demi
  sebuah proyeksi yang punya penghitung inkremental sendiri, dan tepat itulah
  ekor yang mengibaskan anjingnya.
- **Memblokir rebuild untuk proyeksi yang sumbernya punya deskriptor lifecycle**
  — menarik, dan lebih tegas daripada §D. Ditolak untuk gelombang ini: ia
  membuang satu-satunya alat perbaikan proyeksi demi mencegah satu pembacaan
  keliru, dan pilihan itu layak mendapat ADR sendiri kalau seseorang menginginkan
  ketegasannya. Yang tidak boleh terjadi adalah kopling ini tetap tak tertulis,
  dan §D/§E menutup itu.
- **Menambah index menaik** — ditolak, §4. Ia membeli nol dan membayar dengan
  beban tulis di tabel tersibuk repo.
- **`archive.archivable: true`** — ditolak. Baris keputusan mencatat bahwa sebuah
  pemeriksaan berjalan dan apa jawabannya; ia tidak membawa NILAI atribut resource
  maupun identitas subjek di luar `tenant_user_id` (ADR-0049 §6 menyatakan itu
  disengaja). Mengarsipkannya menyimpan aliran keputusan keamanan melewati jendela
  yang retensinya sendiri ada untuk menutupnya, tanpa ada yang bisa dipulihkan
  darinya.
