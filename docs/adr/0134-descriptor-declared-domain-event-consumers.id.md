🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0134-descriptor-declared-domain-event-consumers.md)

<!-- i18n-source-hash: sha256:fff24090998e2b947967481de27180dcd7cbc09f7627da208eee50e6ebcbb4e7 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0134 — Konsumen domain-event dideklarasikan di descriptor modul pemiliknya

- **Status:** Accepted
- **Tanggal:** 2026-10-08
- **Pengambil keputusan:** ahliweb
- **Men-extend:** [ADR-0006](0006-offline-first-sync-outbox.id.md) (disiplin outbox: dispatch tetap in-process dan hanya DB, tanpa panggilan provider di dalam transaksi), [ADR-0013](0013-extension-layers-and-boundary-model.id.md) (sebuah modul menjangkau modul lain hanya lewat edge yang dideklarasikan), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.id.md) (template dipakai langsung; modul domain ditambahkan di `src/modules/` tanpa berkas upstream yang harus disunting)
- **Terkait:** Issue #918 butir 1 dan 4 (port kapabilitas dan spesifikasi AsyncAPI pada butir 2-3 menyusul setelah #915/#916/#917 dan BUKAN bagian keputusan ini); hilir epik `ahliweb/awcms-one` #280 (gelombang A butir A5); [`src/modules/domain-event-runtime/README.id.md`](../../src/modules/domain-event-runtime/README.id.md); `src/modules/_shared/domain-event-consumer-contract.ts`; `scripts/domain-event-consumers-check.ts`

## Konteks

Konsumen runtime dahulu hidup dalam satu array tulisan tangan, `src/modules/domain-event-runtime/infrastructure/consumer-registry.ts`. Ada tiga masalah, dan yang ketiga memblokir modul booking dan workforce:

1. **Arah dependensinya terbalik.** Array itu meng-import konsumen setiap modul yang menginginkannya. Satu-satunya entri nyatanya (`reporting`) membuat `domain_event_runtime` meng-import `reporting`, padahal `reporting` mendeklarasikan `domain_event_runtime` sebagai dependensi. Di tingkat modul itu siklus. `modules:dag:check` tidak dapat melihatnya (ia hanya memvalidasi edge yang dideklarasikan) dan mendeklarasikannya dengan jujur akan membuat gate gagal, sehingga `tests/module-boundary.test.ts` membawanya sebagai pengecualian terdokumentasi dan header berkas itu menyuruh penulis berikutnya untuk tidak "memperbaikinya".
2. **Konsumen tidak dimiliki modul yang memiliki perilakunya.** Segala hal tentang projector `reporting` (event-nya, penghitungnya, aturan penundaan saat rebuild) ada di `reporting`; satu baris yang membuatnya berjalan ada di berkas modul lain.
3. **Repositori hilir tidak dapat menambah konsumen tanpa menyunting berkas upstream.** `ahliweb/awcms-one` menambahkan konsumen `commerce` ke array itu sebagai divergensi lokal tercatat (`domain_event_runtime -> commerce`). Setiap adapter berikutnya, dan setiap modul upstream generik yang menginginkan konsumen (booking, hr_payroll), akan menambah satu suntingan lagi pada berkas yang sama dan satu entri lagi pada daftar pengecualian.

Terpisah dari itu, idempotensi hanyalah konvensi. Pengiriman bersifat at-least-once: handler yang sudah berjalan lalu crash sebelum baris delivery-nya ter-commit memang sah dicoba ulang. Setiap konsumen harus ingat membungkus efeknya dengan `applyConsumerEffectOnce`; tidak ada yang memeriksa bahwa ia melakukannya. Diterbitkan sekali bukan berarti ditangani sekali.

## Keputusan

### 1. Konsumen dideklarasikan di `ModuleDescriptor.domainEventConsumers`

Modul yang mengonsumsi event mendaftarkannya di `module.ts` **miliknya sendiri**, di samping `events`, `permissions`, dan `jobs`, memakai `ModuleDomainEventConsumer` (`_shared/domain-event-consumer-contract.ts`): `name`, `description`, `eventTypes`, `eventVersions`, `maxAttempts` opsional, `idempotency`, dan `handle`. `domain_event_runtime` **membangun** registry-nya dari `listModules()` (`buildDomainEventConsumerRegistry`) dan tidak meng-import konsumen apa pun. Panahnya kini berjalan pemilik -> runtime, arah yang dapat dinyatakan `dependencies` dengan jujur: modul yang mendeklarasikan konsumen harus mencantumkan `domain_event_runtime` (kecuali runtime sendiri) atau validator menolaknya.

Akibat arah ini:

- Import `domain_event_runtime -> reporting` hilang, beserta entri `DOCUMENTED_EXCEPTIONS`-nya. Ketiga konsumen yang sudah ada dipindah: dua konsumen referensi ke descriptor runtime sendiri, projector ke descriptor `reporting`.
- Modul hilir mendaftarkan konsumen dengan mendeklarasikannya di descriptor-nya sendiri. `awcms-one` dapat mencabut divergensinya di `consumer-registry.ts` saat menyinkronkan perubahan ini; tidak ada berkas upstream yang disunting.
- Descriptor tetap ringan import. `handle` diharapkan `await import(...)` implementasinya, karena setiap pemanggil `listModules()` memuat setiap descriptor dan import statis akan menyeret kode database sebuah modul ke semuanya.

### 2. Registry tetap kode, bukan data

Deklarasi adalah kode sumber yang ditinjau. Tidak ada panggilan `registerConsumer()`, tabel, atau hook plugin; himpunan lengkap konsumen untuk sebuah tipe event tetap dapat diketahui dengan membaca kode sumber. `listDomainEventConsumers()` membangun registry pada setiap panggilan (sort dan validasi atas beberapa puluh entri), sehingga modul yang ditambahkan atau descriptor yang disunting setelah startup terlihat. Tanpa cache: cache berkunci identitas dan panjang array `listModules()` akan melewatkan suntingan di tempat, dan tidak terukur perlu; bila kelak ditambahkan, ia harus memakai fingerprint key modul, status, event, dan identitas objek konsumen.

### 3. Satu validator, dua pemanggil; deklarasi tak valid gagal saat build dan di CI

`validateDomainEventConsumerDeclarations` (murni, `domain/consumer-declarations.ts`) menolak: nama konsumen yang bukan snake_case `<segmen>.<segmen>`; **nama ganda**, dalam satu modul maupun antarmodul; **langganan ke tipe event yang tidak dicantumkan modul mana pun di `events.publishes`** (konsumen seperti itu tidak akan pernah menerima pengiriman); tipe atau versi event yang cacat; `eventTypes`/`eventVersions` kosong; `maxAttempts` non-positif; modul pendeklarasi yang tidak bergantung pada `domain_event_runtime`; dan pelanggaran idempotensi pada §5. Runtime memanggilnya saat membangun registry dan **melempar** `DomainEventConsumerRegistryError` yang mendaftar setiap masalah. `bun run domain-events:consumers:check`, dalam rantai `check`, memanggil fungsi yang sama, sehingga gate tidak dapat meloloskan sesuatu yang akan ditolak runtime. CI adalah penjaga utama. Aplikasi tidak punya jalur validasi komposisi saat boot: `src/modules/index.ts` sengaja data murni yang tak pernah memvalidasi, dan `modules:compose:check` hanya skrip CI, sehingga ADR ini tidak mengada-adakannya. Lemparan runtime adalah jaring pengaman untuk komposisi yang tak pernah dilihat CI, dan ia muncul pada publish atau lintasan dispatcher pertama, bukan sebagai konsumen yang diam-diam tak menerima apa pun.

Gate yang sama juga menolak kehilangan **nama yang sudah dirilis**. Nama konsumen adalah `consumer_name` baris delivery, kunci ledger efek, kunci jeda, dan label metrik; mengganti namanya mengorbankan delivery tertunda dan menjalankan ulang efeknya. Ketiga nama yang ada kini dikunci (`SHIPPED_CONSUMER_NAMES`) dan identik byte demi byte dengan yang dipakai registry statis. Projector audit mempertahankan prefiks `logging.` walau kini dideklarasikan `domain_event_runtime`, karena menggantinya lebih mahal daripada konvensi yang dilanggarnya.

### 4. Konsumen mana yang berjalan: semuanya

**Setiap konsumen yang dideklarasikan berjalan, apa pun `status` descriptor modulnya** (termasuk `disabled`) dan apa pun enable/disable per tenant (`awcms_tenant_modules`). Ini identik dengan array statis yang digantikan, yang tidak pernah mengecualikan siapa pun. Draf awal mengecualikan konsumen modul `status: disabled`; itu dihapus karena menelantarkan delivery tertunda, menyembunyikannya dari `listConsumerStates`, membuat replay gagal dengan `UnknownReplayConsumerError`, dan diam-diam menjatuhkan event yang diterbitkan saat modul dinonaktifkan: semantik lossy baru yang tak diminta siapa pun. Aturan "modul nonaktif berarti tanpa event" butuh keputusan tersendiri. **Enable/disable per tenant juga sengaja tidak dikonsultasikan.** Saklar itu terdokumentasi hanya menulis `awcms_tenant_modules` dan tak pernah membongkar kode, job modul tidak mengonsultasikannya, dan fan-out diputuskan sekali saat publish. Dispatcher yang melewati baris sebuah tenant karena modul pemiliknya dimatikan akan menahan baris itu di depan antrean order key lalu memprosesnya sekaligus saat dinyalakan lagi. Apakah tenant mematikan sebuah fitur adalah keputusan yang diambil efek konsumen itu sendiri (ia dapat membaca status modul tenant), bukan sesuatu yang diputuskan transport dengan membiarkan baris tak diproses.

Urutan registry menurut nama konsumen, bukan urutan modul, sehingga dispatcher mengiterasi urutan yang sama pada setiap deployment dari himpunan yang sama, apa pun cara komposisi hilir mengurutkan `listModules()`.

### 5. Idempotensi diterapkan registry, bukan diingat konsumen

`idempotency` adalah `"runtime_effect_once"` (default) atau `"self_managed"`.

- **`runtime_effect_once`:** registry membungkus `handle` dengan `applyConsumerEffectOnce`, berkunci `(tenant, nama konsumen, id event)` di `awcms_domain_event_consumer_effects`: ledger yang sama yang dulu dipanggil konsumen secara manual, sehingga baris efek yang ada tetap cocok. `handle` adalah _efek samping_, bukan handler. Konsumen yang menyatakannya tidak bisa lupa guard karena tak pernah melihatnya. Efek yang gagal me-rollback seluruh transaksi delivery, termasuk marker, dan dicoba ulang lewat jalur backoff/dead-letter biasa.
- **`self_managed`:** `handle` diteruskan tanpa dibungkus dan memiliki idempotensinya sendiri (upsert kunci alami, tabel inbox sendiri). Wajib `idempotencyRationale` yang tak kosong yang menjelaskan mengapa pengiriman ulang tak dapat menggandakan efek; gate menolak yang kosong, dan menolak rationale pada konsumen yang dijaga runtime sebagai klaim basi. Di sinilah konsumen integrasi dengan catatan delivery atau inbox sendiri menyatakannya, sehingga strategi idempotensinya adalah kalimat yang ditinjau di samping namanya, bukan asumsi.

Gate juga menegakkan kebalikannya secara statis: tidak ada berkas di bawah `src/` selain `consumer-effect.ts` dan registry yang boleh merujuk `applyConsumerEffectOnce` dalam kode. `handle` yang turut mengklaim marker akan mendapati marker sudah diambil, melihat `applied: false`, dan diam-diam tak pernah menjalankan efeknya: hijau, salah, dan tak terlihat. `tests/integration/domain-event-consumer-registry.integration.test.ts` membuktikan, terhadap PostgreSQL, bahwa ketiga konsumen menerima fan-out dengan nama tak berubah dan bahwa event yang dikirim ulang (delivery dikembalikan ke `pending`, marker ter-commit) tidak menjalankan efek apa pun dua kali.

## Konsekuensi

- Positif: konsumen dimiliki modul yang memiliki perilakunya; import upstream-ke-hilir dan pengecualian terdokumentasinya hilang; template hilir menambah konsumen tanpa menyunting berkas upstream; langganan ganda dan menggantung gagal di CI; idempotensi bersifat struktural pada jalur default dan dibenarkan dalam prosa untuk pengecualian.
- Positif: `MODULE_CONTRACT_VERSION` menjadi `4.2.0` (aditif: `domainEventConsumers` opsional), `awcms-family-compatibility.yaml` diperbarui, dan tidak ada descriptor yang berubah makna.
- Negatif: `buildDomainEventConsumerRegistry` berjalan pada publish atau lintasan dispatcher pertama sebuah proses dan meng-import daftar modul ke lapisan infrastruktur runtime. Ia murah dan murni, descriptor memang sudah dimuat oleh pemanggil `listModules()` mana pun, dan yang di-import adalah `index.ts` (data), bukan kode aplikasi modul mana pun.
- Negatif: `DOMAIN_EVENT_CONSUMERS` (live binding) dihapus demi `listDomainEventConsumers()`. Di repositori ini satu-satunya pengimpor adalah runtime dan dua tes. Hilir yang mengimpor konstanta itu harus pindah ke fungsi saat sinkronisasi.
- Negatif: `handle` konsumen kini dijangkau lewat `import()` dinamis; path yang salah ketik menjadi galat runtime, bukan galat kompilasi. `bun run typecheck` tetap memeriksa path (import dapat dianalisis statis) dan tes integrasi menjalankan ketiganya.

### Tindak lanjut, tidak diputuskan di sini

- **`DOMAIN_EVENT_TYPE_REGISTRY`** (katalog yang diperiksa `appendDomainEvent` sebelum menyimpan event) masih daftar tulisan tangan di runtime, dan modul hilir yang menerbitkan tipe event baru harus menambah ke dalamnya. Ia adalah kembaran sisi-produsen dari masalah ini dan menginginkan perlakuan yang sama (tipe event dideklarasikan descriptor, gate paritas AsyncAPI membaca daftar tergabung). ADR terpisah.
- **Kategori e-mail.** `email/domain/email-template-categories.ts` berbentuk sama untuk modul `email` (awcms-one menambahkan kategori turunan ke dalamnya sebagai divergensi). Kategori e-mail yang dideklarasikan descriptor adalah separuh kedua butir 1 Issue #918. Tidak diimplementasikan di sini: itu registry berbeda dengan validasinya sendiri (kaitan template dan locale) dan layak mendapat perubahan sendiri.
- Butir 2-3 #918 (port kapabilitas booking, workforce, dan delivery; event AsyncAPI-nya) menyusul setelah #915/#916/#917 mendarat. Mereka akan memakai mekanisme ini dan tidak menambah jalur pendaftaran baru.

## Alternatif yang ditolak

Dievaluasi menurut keamanan, performa, kemudahan pemeliharaan, skalabilitas, kompatibilitas, dan kompleksitas operasional.

### A. API registrasi saat startup (`registerDomainEventConsumer(...)` dipanggil dari bootstrap modul)

- _Keamanan:_ panggilan runtime dapat dilakukan dari mana saja, termasuk kode yang tak berhak mendaftarkan konsumen, dan himpunannya bergantung pada urutan eksekusi. Sifat kode-sumber-yang-ditinjau ("grep memberi tahu seluruh himpunan") hilang.
- _Performa / skalabilitas:_ setara dengan desain terpilih saat runtime.
- _Pemeliharaan:_ butuh hook bootstrap yang harus diingat dijalankan setiap titik masuk (server HTTP, `domain-events:dispatch`, tes, tiap skrip); lupa di satu titik masuk menghasilkan proses dengan himpunan konsumen berbeda, mode kegagalan terburuk di sini (penerbit yang fan-out ke tak seorang pun, atau dispatcher yang mengabaikan baris). Tidak ada tempat statis untuk memvalidasi himpunan, sehingga gate tak dapat melihat duplikat sebelum runtime.
- _Kompatibilitas:_ tanpa perubahan descriptor, tetapi singleton global mutabel baru dengan risiko isolasi tes.
- _Kompleksitas operasional:_ tertinggi; menambah kontrak urutan antara pemuatan modul dan publish pertama.
- Ditolak: descriptor sudah menjadi tempat setiap registry lain di repositori ini, dan dimuat oleh `listModules()` yang sama di mana-mana tanpa bootstrap yang bisa terlupa.

### B. Registry yang dihasilkan saat build (skrip memindai modul dan menulis `consumer-registry.generated.ts`)

- _Keamanan:_ setara; keluarannya kode sumber yang ditinjau.
- _Performa:_ sedikit lebih baik dari desain terpilih (tanpa build runtime), yang tidak material: build adalah sort dan validasi atas beberapa puluh entri, sekali per proses.
- _Pemeliharaan:_ artefak kedua yang harus diregenerasi dan gate drift yang harus dijaga (repositori ini sudah membawa beberapa, dan pernah terkena drift berkas ter-generate setelah dua squash-merge). Template hilir harus meregenerasi berkas di path upstream, yaitu suntingan upstream yang sama yang dihapus ADR ini, satu lapis di baliknya.
- _Kompatibilitas / kompleksitas operasional:_ butuh generator, artefak ter-commit, dan langkah CI; desain terpilih tak butuh satu pun.
- Ditolak: ia memasukkan kembali suntingan berkas upstream lewat berkas ter-generate, demi menghemat pekerjaan yang tidak berbiaya.

### C. Pertahankan array statis, tambah pengecualian terdokumentasi per modul hilir

- Ditolak: itu status quo. Ia berskala satu divergensi dan satu entri pengecualian per adapter, mempertahankan siklus import, dan tidak memberi modul upstream generik (booking, hr_payroll) cara mengonsumsi event tanpa meng-import dari repositori hilir.

### D. Menaruh `handler` (bukan `handle`) di deklarasi dan menyerahkan idempotensi pada tiap konsumen

- Ditolak: itu mempertahankan idempotensi sebagai konvensi. Konsumen contoh semuanya memanggil `applyConsumerEffectOnce` dengan benar; intinya penulis keempat yang tidak melakukannya tak terlihat sampai pengiriman ulang menggandakan posting ledger. Menjadikan default struktural dan pengecualian sebagai kalimat yang ditinjau memindahkan kegagalan dari produksi ke review.
