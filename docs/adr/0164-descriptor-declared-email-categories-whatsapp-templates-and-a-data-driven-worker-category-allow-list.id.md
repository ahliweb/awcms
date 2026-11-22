🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0164-descriptor-declared-email-categories-whatsapp-templates-and-a-data-driven-worker-category-allow-list.md)

<!-- i18n-source-hash: sha256:30418927cece85078312f3a780dd0f36b295c0958e84718cc8cfd0aed4bc868f -->

# ADR-0164 — Kategori e-mail dan template WhatsApp dideklarasikan di descriptor modul, dan allow-list kategori worker adalah data

- **Status:** Diterima (22 November 2026). Dasar: sudah diimplementasikan dan digerbangi sejak #1361 (`sql/410`, `bun run extension-points:check`); status menyusul kenyataan.
- **Tanggal:** 2026-11-15
- **Pengambil keputusan:** ahliweb (pemilik), untuk dikonfirmasi
- **Menyelesaikan:** Issue #1277.
- **Men-extend:** [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md) (modelnya: modul mendeklarasikan apa yang dimilikinya, engine pusat membaca `listModules()`), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.id.md) bagian 4 (template WhatsApp berawalan modul), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.id.md) (template dipakai langsung, jadi tidak boleh ada berkas milik upstream yang perlu disunting hilir).
- **Terkait:** `sql/302` (guard yang dijadikan data), `sql/109` dan `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (preseden tabel global read-only), `src/modules/_shared/extension-point-declarations.ts`, `scripts/extension-points-check.ts`.

## Konteks

Tiga titik ekstensi `email` dan `whatsapp_delivery` masing-masing hanya dapat dijangkau dengan menyunting berkas milik upstream, dan masing-masing gagal secara senyap:

1. **Kategori e-mail turunan.** `registerDerivedEmailTemplateCategory` mengisi map lokal-proses. Modul yang memanggilnya dari kodenya sendiri memperbaiki proses web dan membiarkan `email:dispatch`, proses terpisah, tanpa allow-list untuk kategori itu. `renderEmailTemplate` lalu **tidak** mensubstitusi variabel apa pun, dan e-mail terkirim dengan nilai kosong. Pada satu embedder hilir ini memblokir peluncuran (kode sekali pakai dirender kosong). Ini bukan hanya masalah hilir: di repositori ini `newsletter` meng-enqueue `derived.newsletter_confirmation`, yang tidak didaftarkan siapa pun di proses mana pun, sehingga tautan konfirmasinya dirender sebagai string kosong.
2. **Template WhatsApp.** Bentuknya sama: `registerWhatsappTemplate` lokal-proses, `booking` mendaftar lewat fungsi yang harus di-import eksplisit oleh `scripts/whatsapp-dispatch.ts`, `scripts/whatsapp-meta-preflight.ts`, dan `scripts/booking-reminders-dispatch.ts`. Produk hilir menambah barisnya sendiri ke skrip yang sama. Baris yang terlupa menjadi `template_unknown` saat runtime, bukan galat build.
3. **Allow-list kategori worker.** `sql/302` membuat `awcms_email_messages_worker_guard` menolak insert worker di luar tiga kategori, dengan daftar **di dalam badan fungsi**. Template hilir yang butuh kategori keempat menerbitkan ulang fungsi itu di migrasinya sendiri, yang diam-diam menimpa setiap perubahan upstream berikutnya (uji keanggotaan, `search_path`, kode galat) dengan salinan basi.

## Keputusan

### 1. Dua field descriptor opsional baru (kontrak modul 4.7.0)

`ModuleDescriptor.emailTemplateCategories` (`category`, `allowedVariables`, `workerInsert` opsional) dan `ModuleDescriptor.whatsappTemplates` (bentuk persis yang divalidasi `registerWhatsappTemplate`). MINOR dan murni aditif: tidak ada descriptor yang berubah makna. `awcms-family-compatibility.yaml` mencatat 4.7.0.

### 2. Di-resolve sesuai kebutuhan oleh pemilik registry, di setiap proses

Tanpa panggilan startup, tanpa hook, tanpa impor yang bisa dilupakan konsumen.

- `email/domain/email-template-categories.ts` me-resolve allow-list `derived.*` dari **sumber descriptor yang dipasang composition root** saat pencarian, setelah daftar base tetap. Pencariannya memindai beberapa puluh descriptor; tidak ada cache yang harus diinvalidasi.
- `whatsapp-delivery/domain/whatsapp-templates.ts` mendaftarkan template setiap descriptor yang belum terlihat pada `getWhatsappTemplate` / `listWhatsappTemplates` pertama dan memproses tiap descriptor sekali.

Sumbernya adalah seam injeksi kecil (`_shared/extension-point-source.ts`). **Composition root** memasangnya sekali: entri web (`src/middleware.ts`) dan skrip dispatcher yang merender atau mengirim kategori dan template turunan (`email-dispatch`, `whatsapp-dispatch`, `whatsapp-meta-preflight`, `booking-reminders-dispatch`), memanggil `installExtensionPointSource(listModules)`. Kedua registry sengaja **tidak** meng-import daftar modul sendiri (lihat konsekuensi least-privilege). Proses yang menanyakan hal yang hanya bisa dijawab descriptor (kategori `derived.*`, kunci template yang bukan bawaan) tanpa sumber terpasang mendapat `ExtensionPointSourceNotInstalledError` yang jelas, **bukan** "kategori tak dikenal, tanpa variabel" (celah senyap per-proses yang dihapus ADR ini); kategori base dan `system.notice` tak butuh sumber. Gate memastikan tiap composition root memasangnya. `registerDerivedEmailTemplateCategory` dan `registerWhatsappTemplate` tetap sebagai alat dan seam uji milik registry; sebuah gate (bagian 4) menolak pemanggil lain.

Fail-closed terjaga: kategori `derived.*` yang tak dideklarasikan tetap tak dikenal (allow-list `null`, semua variabel dibuang, pembuatan template ditolak), dan deklarasi `derived.*` tak dapat menutupi kategori base.

### 3. Allow-list worker adalah baris `awcms_email_worker_categories` (`sql/410`)

Tabel global, satu `category` per baris, di-seed `sql/410` dengan gabungan persis kategori yang diizinkan badan guard TERBARU (`sql/371`, bukan `sql/302`): tiga `hr.attendance_correction_*` dan tiga `crm.follow_up_*`, sehingga perilaku tak berubah. `sql/410` mengganti fungsi guard **sekali**, agar membaca tabel; selebihnya guard adalah badan `sql/371` (kondisi penerima staf dan kunci variabel untuk `crm.follow_up_*` tetap; keanggotaan `awcms_worker` diperiksa untuk `session_user` dan `current_user`, superuser dikecualikan, `search_path` dipatok berakhir `pg_temp`).

- **Fail-closed:** ujinya `NOT EXISTS` atas tabel, jadi tabel kosong menolak setiap insert worker, dan ketiadaan baris yang menolak.
- **Read-only saat runtime:** `awcms_app` dan `awcms_worker` hanya memegang `SELECT` (guard berjalan sebagai role yang meng-insert). Jalur runtime yang bisa meng-insert di sini dapat memperlebar repertoarnya sendiri dan tak ada kebijakan RLS yang keberatan, sebab tak ada kolom tenant; tabel ini karena itu masuk `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (tanpa INSERT/UPDATE/DELETE) dan berkunci `SELECT` di `WORKER_ROLE_GRANTS`, persis seperti katalog entitlement `sql/109`.
- **Cara modul menambah kategori:** `emailTemplateCategories: [{ ..., workerInsert: true }]` ditambah `INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.x') ON CONFLICT DO NOTHING` di migrasi modul itu sendiri. Gate memeriksa silang flag terhadap baris yang di-seed di kedua arah (kategori berflag harus di-seed; **setiap** baris seed harus diklaim: oleh deklarasi berflag, atau oleh klaim `workerEmailCategories` pada descriptor modul pemilik, dengan satu alasan per entri, dua arah persis dan satu pemilik per kategori; gate juga membaca daftar literal badan guard terakhir sebelum `sql/410` dan gagal bila seed lebih sempit darinya), sehingga izin tanpa pemilik tak dapat melebarkan worker secara senyap. Migrasi setelah `sql/410` yang menerbitkan ulang fungsi guard menggagalkan gate.

### 4. Satu gate, `bun run extension-points:check` (dalam `check`)

Murni, tanpa database: menjalankan validator bersama atas setiap descriptor (awalan `derived.`, snake case, tanpa duplikat antarmodul, tanpa bentrok dengan kategori base, nama variabel valid dan unik, kunci WhatsApp berawalan modul pemilik, template security wajib punya variabel rahasia, modul pendeklarasi bergantung pada `email`, atau bergantung pada / mengonsumsi `whatsapp_delivery`); memastikan registry WhatsApp memuatnya; menolak pemanggilan kedua fungsi register di luar berkas milik registry (tes tidak dipindai); dan menjalankan tiga pemeriksaan allow-list worker di atas. Pembaca SQL-nya fail-closed: ia memahami INSERT ber-schema/bertanda-kutip/multi-baris dan melaporkan setiap pernyataan yang menyentuh tabel atau fungsi/trigger guard yang tak bisa dibacanya (INSERT...SELECT, ekspresi, UPDATE, DELETE, TRUNCATE, COPY, blok DO). `tests/descriptor-extension-points.test.ts` membuktikan ia merah saat tiap proteksi dicabut, dan menjalankan **proses bun baru** yang hanya meng-import kode dispatcher sendiri untuk menunjukkan kategori dan template yang dideklarasikan dikenal di sana; `tests/integration/email-worker-category-allow-list.integration.test.ts` mengerjakan separuh database sebagai role `awcms_worker` sungguhan.

## Konsekuensi

- Positif: kategori dan template modul ikut bersama modul; tidak ada berkas milik upstream yang disunting di hilir, jadi sinkronisasi subtree tak punya apa pun untuk diperiksa ulang; registrasi yang hilang tak lagi kegagalan hanya-runtime. E-mail konfirmasi `newsletter` di repo ini kini merender tautannya. Impor side-effect `booking` (`infrastructure/booking-whatsapp-templates.ts`) dan tiga panggilan di skrip hilang.
- Positif: fungsi guard punya satu pemilik; hilir menambah baris, tidak pernah fungsi.
- Perubahan perilaku untuk embedder: embedder yang memanggil `registerDerivedEmailTemplateCategory` / `registerWhatsappTemplate` dari kode aplikasi kini gagal `extension-points:check` dan memindahkan deklarasi ke descriptor-nya; yang menerbitkan ulang fungsi guard kehilangan override itu dan harus men-seed baris (dengan kategori dideklarasikan `workerInsert`).
- Negatif: setiap proses yang merender kategori turunan atau memakai template turunan harus memasang sumber di composition root-nya; proses baru yang lupa gagal keras dan jelas (bukan senyap), dan menambah root berarti mengedit `COMPOSITION_ROOTS` di gate.
- Least-privilege tidak mundur: karena registry tidak meng-import daftar modul, closure import statis job seperti `omnichannel-inbox:sla` tidak berubah dan `WORKER_DATABASE_URL`-nya tetap ditahan runner (`appRoleTargetsWithoutWorkerClient`, audit L-5 PR #1301; diverifikasi oleh `tests/descriptor-extension-points.test.ts`). Desain awal ADR ini yang meng-import `listModules` di registry menghilangkannya; alternatif composition-root itulah yang kini dipakai.
- Negatif: deklarasi WhatsApp yang cacat melempar pada pencarian pertama di sebuah proses, bukan saat startup; gate adalah penjaga utama dan lemparan adalah jaring pengaman.
- Di luar cakupan: kaitan **locale/key** template e-mail, `DOMAIN_EVENT_TYPE_REGISTRY` (tindak lanjut ADR-0134) dan perubahan apa pun tentang siapa yang boleh meng-enqueue dari worker selain daftar berbasis data.

## Alternatif yang ditolak

### A. Panggilan `registerX()` dari hook bootstrap

Ditolak karena alasan ADR-0134 untuk alternatif A-nya: himpunannya bergantung pada setiap titik masuk mengingat menjalankan hook, dan mode kegagalannya (proses dengan himpunan berbeda) persis cacat yang dihapus.

### B. Berkas registry yang dihasilkan saat build

Ditolak seperti alternatif B ADR-0134: artefak kedua yang harus diregenerasi, dan template hilir akan meregenerasi berkas di path upstream, yaitu suntingan yang ingin dihilangkan.

### C. Pertahankan fungsi dan minta embedder menerbitkannya ulang dengan prosedur terdokumentasi

Ditolak: itu status quo. Override-nya senyap dan permanen; dokumentasi tidak membuat badan fungsi basi menjadi segar.

### D. Setelan sesi database (GUC) untuk kategori yang diizinkan

Ditolak: sesi worker dapat menyetelnya sendiri, sehingga guard tak melindungi apa pun dari worker yang dikompromikan, padahal itu seluruh tujuannya.

### E. Guard `SECURITY DEFINER` yang membaca tabel yang tak dapat dibaca worker

Ditolak: di dalam fungsi definer `current_user` adalah pemilik, dan pengecualian superuser (`rolsuper` dari `current_user`) akan membebaskan setiap pemanggil bila pemiliknya superuser. Memberi worker `SELECT` atas daftar read-only lebih sederhana dan hanya membocorkan nama kategori.

## Catatan keputusan (22 November 2026)

Diterima. Keputusan didelegasikan pemilik kepada orchestrator ("pilihkan yang terbaik sesuai rekomendasi dan praktek profesional, prioritas skalabilitas, performa dan security"). Dasarnya faktual: field descriptor, `awcms_email_worker_categories` (`sql/410`) dan gerbang `extension-points:check` sudah diimplementasikan dan ditegakkan CI sejak #1361, sehingga ADR ini mencatat apa yang sudah benar. Teks di atas tidak diubah.
