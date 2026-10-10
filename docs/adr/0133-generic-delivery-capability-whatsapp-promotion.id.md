🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0133-generic-delivery-capability-whatsapp-promotion.md)

<!-- i18n-source-hash: sha256:28f63d6a3bc575c75b4ca6e35c9f7c1af360fe9d2ab5180756995bae3e05a5cd -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0133 — Pengiriman WhatsApp dipromosikan menjadi kapabilitas upstream generik (`whatsapp_delivery`); Telegram dan orkestrasi ditunda

- **Status:** Accepted
- **Tanggal:** 2026-10-08
- **Pengambil keputusan:** ahliweb
- **Men-extend:** [ADR-0006](0006-offline-first-sync-outbox.id.md) (tanpa panggilan jaringan di dalam transaksi DB), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md) (konsumen bergantung pada port netral), [ADR-0074](0074-push-delivery-is-a-second-outbox.id.md) (preseden lease-outbox dan aturan "kredensial per deployment"), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md) (setiap tabel menjawab pertanyaan subjek data)
- **Terkait:** Issue #917 (ADR ini); hilir `ahliweb/awcms-one#280` (epik) item A4, [awcms-one ADR-0040](https://github.com/ahliweb/awcms-one/blob/main/docs/adr/0040-aw-business-platform-capability-ownership-and-boundaries.md) (penempatan: pengiriman generik masuk upstream lebih dulu), awcms-one ADR-0017 (port WhatsApp milik commerce) dan ADR-0034 (pengiriman dokumen menumpang outbox itu); saudara yang diterima paralel: booking (ADR-0131), hr_payroll (ADR-0132), registrasi konsumen (ADR-0134)

**Hanya dokumen.** ADR ini tidak menambah kode modul, migrasi, path OpenAPI, maupun channel AsyncAPI. Implementasi adalah issue terpisah, dengan gerbang berupa daftar periksa di §9.

## Konteks

Tiga modul upstream sebentar lagi perlu mengirim pesan WhatsApp: booking (pengingat, konfirmasi), workforce/hr_payroll (_pemberitahuan_ shift dan payroll) dan, sudah hari ini di template hilir, `commerce` (OTP pelanggan, order-paid, kampanye, pengiriman struk/faktur). Upstream punya dua kapabilitas pengiriman:

- `email` — outbox + dispatcher lease + port `EmailProvider` + adapter Mailketing + kategori/template + daftar supresi.
- `push_delivery` — outbox **kedua** (ADR-0074) dengan adapter FCM v1 dan Web Push/VAPID.

WhatsApp hanya ada di hilir: modul `commerce` milik `awcms-one` memiliki port `WhatsappProvider` (`send`, `healthCheck`), adapter Fonnte / Meta Cloud / `log`, tabel `awcms_commerce_whatsapp_messages` dan `awcms_commerce_whatsapp_delivery_attempts` (migrasi `sql/9xx`), job `commerce:whatsapp:dispatch` dan `commerce:whatsapp:purge`, serta registri template (`commerce.customer_otp`, `commerce.order_paid`, `commerce.campaign`, `commerce.document`). Kredensialnya per deployment dan dibaca dari environment; dibungkus `withTimeout` dan `getProviderCircuitBreaker`; provider dipanggil di luar transaksi apa pun. Itu implementasi yang sehat, tetapi di tempat yang salah untuk kapabilitas yang dibutuhkan lebih dari satu domain: booking dan hr_payroll upstream tidak bisa bergantung pada modul yang hanya ada di template turunan, dan template turunan yang menumbuhkan salinan sendiri per domain adalah hal yang hendak dihindari epik #280.

Batasan di issue adalah **tanpa outbox kedua**. Dibaca harfiah ini tidak mungkin dipenuhi (ADR-0074 sudah menjadikan push outbox kedua, dengan alasan yang masih berlaku), sehingga §3 menyatakan dengan tepat apa arti batasan itu dan apa yang dipakai ulang.

## Keputusan

### 1. Opsi (a): modul upstream generik `whatsapp_delivery`, berdampingan dengan `email` dan `push_delivery`

Dibandingkan pada sumbu yang disebut issue:

| Sumbu                    | **(a) Promosikan menjadi kapabilitas upstream generik; commerce mempertahankan adapter kompatibilitas sampai bermigrasi (dipilih)**                                                                                                                       | (b) Hanya port upstream yang stabil; implementasi commerce tetap menjadi adapter selama migrasi                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keamanan                 | Satu implementasi jalur kredensial, circuit breaker, masking, pemeriksaan consent, dan aturan tanpa-I/O-dalam-transaksi untuk diaudit, di repo yang punya gerbang keamanannya (`bun run check`, RLS `FORCE`, ABAC default-deny, registri data-lifecycle). | Aturan ditegakkan oleh **kontrak port** di upstream dan oleh **kode yang tak terlihat dan tak teruji upstream** di hilir. Port tanpa implementasi upstream adalah janji yang tak bisa dicek CI; aturan melenceng di adapter lebih dulu.                                                       |
| Performa                 | Booking dan hr melakukan enqueue dengan panggilan dalam-proses dan satu INSERT di transaksi mereka sendiri; tanpa lompatan lintas repo. Bentuk dispatcher claim/lease yang sama dengan yang sudah terukur untuk email dan push.                           | Sama saat runtime, tetapi modul upstream dan tesnya butuh adapter palsu, sehingga jalur panas aslinya tak pernah dilatih di upstream.                                                                                                                                                         |
| Kemudahan pemeliharaan   | Satu pemilik untuk provider (Fonnte/Meta), template, kebijakan retry. Upstream adalah system of record; hilir mengonsumsi lewat subtree sync, jalur yang sudah ditempuh inventori, pajak, dan procurement (ADR-0126/0127/0128).                           | Arah dependensi terbalik: upstream memanggil adapter yang hidup di template yang bergantung pada upstream. Setiap perbaikan dibuat di hilir lalu di-back-port, hal yang justru hendak dicegah ADR-0034 (keluarga dipakai-langsung) dan ADR-0055 (pengembangan terbatas di awcms/awcms-astro). |
| Skalabilitas             | Tabel per tenant, indeks claim `(tenant_id, status, next_attempt_at)`, bentuk sama dengan `awcms_email_messages`. Domain tambahan menambah baris, bukan antrean atau worker.                                                                              | Bentuk sama, tetapi deployment tanpa `commerce` (hanya booking, hanya hr) **tidak punya WhatsApp sama sekali**, sehingga setiap deployment seperti itu harus membawa commerce hanya untuk mengirim pengingat.                                                                                 |
| Kompatibilitas           | Commerce tetap berjalan sepanjang waktu: fungsi publiknya (`enqueueWhatsappMessage`, job dispatch/purge, layar admin dan API) bertahan sampai kondisi akhir di §6; ia menjadi adapter tipis di atas port.                                                 | Nol perubahan untuk commerce — tetapi juga nol kemajuan atas masalahnya.                                                                                                                                                                                                                      |
| Kompleksitas operasional | Satu pasang job baru (`whatsapp:dispatch`, `whatsapp:purge`) dan, untuk sementara, pasangan commerce lama yang menguras. Dibatasi oleh kondisi akhir. Ops sudah paham bentuk lease/retry.                                                                 | Tanpa job baru, tetapi permanen ada dua tempat WhatsApp bisa tersangkut, dicoba ulang dua kali, atau salah konfigurasi.                                                                                                                                                                       |
| Jangka panjang           | Telegram, bila pernah diterima, adalah adapter atau modul saudara dengan pola sama; commerce menyusut. Migrasi punya akhir yang jelas.                                                                                                                    | Commerce menjadi layanan platform de facto yang harus dipakai modul lain, membalik DAG yang digambar epik #280 (ADR-0040: "tidak ada domain bergantung pada kanal, commerce di atas infrastruktur generik"). Adapter "sementara" tak punya akhir alami dan menjadi permanen.                  |

**Keputusan: (a).** Port pada (b) tidak dibuang: ia adalah kontrak di §8, dan ia yang membuat (a) dapat dimigrasikan, karena adapter kompatibilitas commerce mengimplementasikan bentuk yang sama pada arah berlawanan (commerce memanggil port). Memilih (a) berarti port punya implementasi upstream yang nyata, bukan berarti tak ada port.

### 2. Apa yang dipromosikan, dan apa yang tidak

Dipromosikan ke `src/modules/whatsapp-delivery/` (key `whatsapp_delivery`, `type: "system"`, feature flag **mati** secara default, `WHATSAPP_ENABLED=true` untuk menyalakan, persis seperti `PUSH_ENABLED`/email):

- port provider (`send`, `healthCheck`) dan bentuk hasil (`ok` / `retryable` / `skipped`), dengan adapter Fonnte, Meta Cloud, dan `log`;
- antrean per tenant dan ledger per-percobaan, dispatcher claim/kirim/finalisasi, retry/backoff, job purge;
- registri template berkunci `templateKey`, dengan allow-list variabel berversi;
- catatan supresi/consent dan pemeriksaan purpose (§4);
- permukaan observabilitas admin (diagnostik antrean, batal, CRUD supresi), mengikuti preseden `email` — diwajibkan ADR-0021 sebelum modul boleh `active`.

**Tidak dipromosikan**: template commerce (`commerce.customer_otp`, `commerce.order_paid`, `commerce.campaign`, `commerce.document`) dan logika domain commerce yang memutuskan _kapan_ mengirimnya. Mereka dimiliki domainnya dan didaftarkan ke registri upstream sebagai key berawalan modul. Upstream tidak mengirim kata-kata bisnis apa pun kecuali satu template netral `system.notice`.

### 3. "Tanpa outbox kedua", dinyatakan dengan tepat

`push_delivery` **adalah** outbox kedua (ADR-0074), dan alasan ADR-0074 berlaku untuk WhatsApp tanpa perubahan: `awcms_domain_events` menjalankan claim, handler, dan finalisasi dalam satu transaksi secara sengaja, dan provider WhatsApp adalah panggilan HTTP, yang dilarang ADR-0006 di dalam transaksi. WhatsApp karena itu tidak dapat menjadi konsumen domain event, dan ia **tidak** bergabung ke `awcms_domain_events`.

Ia juga tidak bergabung ke `awcms_email_messages`. Baris tabel itu berbentuk untuk e-mail (penerima, lampiran, kategori, supresi per alamat); menambahkan diskriminator kanal akan membuat dua dispatcher meng-claim dari tabel campuran dan menjadikan kebijakan retry e-mail urusan WhatsApp. ADR-0074 menolak generalisasi yang sama dengan alasan yang sama.

Jadi jawaban jujurnya: **WhatsApp mendapat tabel antrean kanal, dan itu adalah tabel outbox ketiga di repo.** Yang dituju batasan itu adalah aturan di bawah, yang dijadikan mengikat oleh ADR ini:

> **Satu antrean per kanal per deployment, tidak pernah satu per domain.** Booking, hr_payroll, commerce, dan setiap konsumen mendatang melakukan enqueue ke antrean tunggal `whatsapp_delivery` lewat port-nya. Tidak ada modul konsumen yang menambah tabel, dispatcher, atau panggilan provider WhatsApp (atau e-mail, atau push) sendiri. Yang ditolak adalah **antrean WhatsApp kedua** — terutama yang akan ada bila tabel commerce dan tabel upstream baru sama-sama tetap hidup — serta antrean keempat, kelima, keenam dari tiap domain baru.

Tabel kanal bukan _mekanisme_ outbox baru. Yang dipakai ulang, dengan referensi bukan salinan di mana kode dapat dibagi:

- **Semantik lease**: claim dengan `FOR UPDATE SKIP LOCKED`, lease dengan memakai ulang `next_attempt_at` (tanpa kolom baru), kirim di luar transaksi, finalisasi per baris — bentuk `email-dispatch.ts`, `object-dispatch.ts`, `purge-queue.ts`, dan dispatcher push. Helper murni (hitung backoff, konstanta lease, pencatatan percobaan) diimpor dari lokasi bersama yang ada hari ini; ADR ini tidak mewajibkan mengekstrak abstraksi bersama baru lebih dulu, dan tidak melarang melakukannya di PR implementasi bila salinan keempat akan ditulis.
- **Retry/backoff dan circuit breaker**: `getProviderCircuitBreaker(providerKey)` hanya di dalam adapter, sehingga penolakan per-pesan (nomor salah, template salah) tak pernah memicunya; semantik `retryable` / `skipped` seperti pada `EmailDeliveryResult`.
- **Retensi**: setiap tabel modul membawa deskriptor di registri `data_lifecycle` sejak hari pertama (ADR-0074 §3: `TABLES_PREDATING_THE_RULE` tertutup dan `BOUNDED_BY_DESIGN` kosong). Purge memakai bentuk **`delegated`** dengan status terminal eksplisit dan `updated_at` sebagai kursor, tidak pernah usia saja — penghapusan generik berbasis usia yang diarahkan ke antrean menghapus pesan yang masih menunggu pemadaman provider.
- **Kredensial per deployment** (ADR-0074 §5, awcms-one ADR-0017 D1), **disiplin tiga kolom** untuk alamat (`recipient` / `recipient_hash` / `recipient_masked`, kolom mentah disebut di satu berkas saja), dan aturan **same-origin/tanpa-token-di-event**: domain event membawa _siapa_ dan _apa_, tidak pernah nomor telepon.

Yang **tidak** dipakai ulang: jalur konsumen `awcms_domain_events`, tabel e-mail, dan antrean per domain apa pun.

### 4. Kelas purpose dan consent

Setiap pesan membawa `purpose` yang ditetapkan oleh **registrasi template pemanggil**, bukan input bebas per pesan: sebuah template key didaftarkan dengan tepat satu purpose, dan pemanggil tidak dapat mengirim template `marketing` sebagai `transactional`.

| Purpose         | Contoh                                                                                       | Consent                                                                                                                                                                              | Supresi / opt-out                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactional` | konfirmasi/pengingat booking, struk, status pesanan, pemberitahuan shift (tanpa PII/nominal) | Tanpa consent marketing. Penerima default-nya subjek catatan sumber; penerima lain adalah izin terpisah (awcms-one ADR-0034 D5).                                                     | Menghormati **daftar supresi** kanal (kegagalan permanen, balasan "stop", nomor dipindahtangankan). Opt-out marketing tidak menyembunyikan pesan transaksional; hard bounce menghentikannya. |
| `security`      | OTP, kode login/step-up, peringatan perubahan akun                                           | Tidak ada, dan opt-out marketing tidak pernah memblokirnya. Sampai ke penerima adalah intinya.                                                                                       | Hanya menghormati supresi kegagalan permanen. Tidak pernah dibatch, tidak pernah dalam kampanye.                                                                                             |
| `marketing`     | kampanye, promosi, re-engagement                                                             | **Opt-in eksplisit, per penerima, per kanal, tercatat** dengan sumber dan waktu. Diperiksa saat enqueue **dan lagi saat dispatch**, sehingga penarikan berlaku dalam hitungan menit. | Opt-out seketika dan mengalahkan semua yang antre. Mengirim ke nomor tanpa consent tercatat ditolak (`CONSENT_REQUIRED`), bukan dilewati diam-diam.                                          |

**Consent independen dari keanggotaan segmen.** Berada di segmen pelanggan, tier loyalti, daftar CRM, atau audiens kampanye tidak pernah menyiratkan consent; segmen mempersempit _siapa yang layak diminta_, catatan consent memutuskan _siapa yang boleh dikirimi_. Pemeriksaan marketing melakukan join ke tabel consent, bukan segmen. Perubahan definisi segmen karenanya tak pernah bisa mengubah orang yang tidak setuju menjadi penerima.

Kekhususan kelas security (membawa rahasia dan terikat waktu):

- `expiresAt` wajib. Pesan yang melewatinya **kedaluwarsa, tidak dicoba ulang terlambat** — OTP yang tiba setelah masa berlakunya lebih buruk daripada tidak ada.
- Variabel yang berupa rahasia (kode OTP) **dihapus dari baris antrean saat mencapai status terminal** dan tak pernah ditulis ke percobaan, audit, log, atau event. Provider yang butuh nilainya saat kirim (parameter template OTP Meta) menerimanya di memori dari baris yang di-claim.
- Batas laju per penerima dan per tenant berlaku saat enqueue; itu kontrol keamanan sekaligus kontrol biaya.
- Modul ini tidak melakukan fallback lintas kanal (§7).

**Payroll dan data pribadi.** Pesan hr_payroll bersifat `transactional` dan **hanya pemberitahuan**: menyatakan bahwa sesuatu tersedia, dengan paling banyak tautan same-origin ke halaman terautentikasi. Ia tidak pernah membawa gaji, potongan, rincian bank, identitas pajak, NIK, atau data kesehatan di body maupun variabel. Ini ditegakkan oleh allow-list variabel template (variabel di luar daftar dibuang renderer, seperti pada `email`), bukan oleh disiplin pemanggil.

### 5. Aturan provider (mengikat implementasi)

1. **Kredensial hanya dari environment**, satu set per deployment, tidak pernah per tenant (token dari tenant memungkinkan admin satu tenant membuat deployment bicara sebagai orang lain — ADR-0074 §5). Tidak pernah disimpan plaintext di database, tidak pernah di log, baris audit, event, atau pesan error. Nilai multi-baris atau berbentuk JSON tiba sebagai base64, karena `scripts/validate-env.ts` mem-parse `.env` baris demi baris. Provider dipilih lewat env (`WHATSAPP_PROVIDER=fonnte|meta|log`), dengan `log` sebagai default sehingga provider yang hilang turun menjadi "dicatat, tidak dikirim", tidak pernah crash.
2. **Tanpa I/O jaringan di dalam transaksi DB** (ADR-0006). Enqueue adalah satu INSERT di transaksi _pemanggil_ (sehingga booking yang di-rollback tak pernah mengirim pengingat); dispatcher meng-claim dalam transaksi singkat, commit, memanggil provider, lalu finalisasi per baris di transaksi baru.
3. **Panggilan provider berbatas**: setiap panggilan dibungkus `withTimeout`; `getProviderCircuitBreaker` di adapter; breaker terbuka mengembalikan `skipped`, sehingga tak ada percobaan tercatat dan tak ada retry terpakai.
4. **Retry/backoff**: `retryable` untuk timeout/429/5xx, terminal untuk penolakan 4xx atas pesan; percobaan dibatasi dengan backoff eksponensial dan jitter; `failed` terminal adalah status yang dapat dibaca pemanggil, bukan exception.
5. **Idempotensi**: enqueue menerima kunci idempotensi dari pemanggil (unik per `(tenant_id, idempotency_key)`); replay mengembalikan pesan yang ada tanpa menyisipkan. Claim dispatcher berbasis lease sehingga baris dari worker yang crash dapat di-claim ulang dan sebuah baris tak pernah dikirim dua worker sekaligus. At-least-once ke provider diakui; id pesan provider dicatat untuk mendeteksi duplikat saat rekonsiliasi.
6. **Masking**: nomor telepon dinormalisasi ke E.164, disimpan di kolom mentah, di-hash (`recipient_hash`) untuk pencarian supresi dan deteksi duplikat, dan di-mask (`recipient_masked`) di tempat lain — daftar admin, baris audit, log, event, dan teks error. Tidak ada respons selain jalur reveal pesan-tunggal (bila pernah ditambahkan, sebagai izin teraudit terpisah dengan `no-store`) yang membawa nomor mentah.
7. **Redaksi saat disimpan**: `body` yang dirender adalah bagian sensitif baris; job purge dan jalur penghapusan subjek data (ADR-0094) sama-sama menjangkaunya, dan pembersihan status terminal di §4 berlaku untuk rahasia.
8. **Callback masuk** (tanda terima pengiriman, balasan "stop") adalah pertanyaan terbuka (§10), tidak diputuskan di sini; bila dibangun, mengikuti awcms-one ADR-0017 D2 (token endpoint opak per tenant, tanda tangan diverifikasi timing-safe, perlindungan replay dengan kunci unik) dan tidak pernah meresolusi tenant dari payload.

### 6. Jalur migrasi dan KONDISI AKHIR adapter kompatibilitas commerce

Fase (masing-masing PR sendiri; tidak ada yang mulai sebelum yang sebelumnya merge):

0. **ADR ini** (hanya dokumen).
1. **Implementasi upstream** (issue berikutnya): `whatsapp_delivery` mendarat inert (flag mati), dengan tabel, job, adapter, permukaan admin, OpenAPI/AsyncAPI sendiri. Konsumen upstream (booking, hr_payroll) boleh memanggil port.
2. **Sync hilir + adapter**: awcms-one menyinkronkan subtree; `enqueueWhatsappMessage` commerce menjadi adapter tipis yang memanggil port dan mendaftarkan template `commerce.*`. Mode per tenant (`legacy` | `upstream`) memilih ke mana pesan **baru** pergi.
3. **Cutover per tenant**: ubah ke `upstream`. **Tanpa dual write dan tanpa penyalinan baris**: baris in-flight di tabel lama dikuras dispatcher lama sampai terminal; hanya pesan baru yang masuk antrean baru. Dua antrean hidup untuk satu tenant sekaligus adalah tepat "antrean WhatsApp kedua" yang ditolak ADR ini, sehingga tenant berada di tepat satu mode pada satu waktu, dan perpindahan terjadi hanya bila tenant itu tak punya baris non-terminal di antrean lama (perpindahan menunggu pengurasan).
4. **Penghapusan.**

**Kondisi akhir (semua harus terpenuhi; lalu adapter dan jalur lama dihapus, bukan dibiarkan dorman):**

1. Setiap pemanggil commerce — OTP pelanggan, order-paid, kampanye, dan pengiriman dokumen (awcms-one ADR-0034) — melakukan enqueue lewat port upstream, diverifikasi tes hilir yang gagal bila berkas commerce mengimpor tabel atau provider WhatsApp-nya sendiri.
2. Setiap tenant di setiap deployment berada di mode `upstream`, dan `awcms_commerce_whatsapp_messages` punya **nol baris non-terminal**.
3. Jendela retensi lama untuk baris terminal telah lewat, atau dipurge oleh `commerce:whatsapp:purge`; ledger percobaan pengiriman demikian pula.
4. `commerce:whatsapp:dispatch`, `commerce:whatsapp:purge`, layar admin/path API WhatsApp milik commerce, dan flag mode `legacy` dihapus, dengan path API lebih dulu dialihkan atau di-alias ke path upstream selama **satu rilis minor** dan diumumkan di changelog.
5. Migrasi hilir akhir men-drop dua tabel lama (keputusan kelas-restore yang dicatat di ADR hilir, bukan migrasi `down`).

**Batas akhir:** adapter dihapus selambat-lambatnya **rilis minor kedua template hilir setelah rilis yang pertama kali mengirim mode `upstream` (langkah 2)**; bila kondisi di atas belum terpenuhi saat itu, keputusan memperpanjangnya membutuhkan ADR baru dengan tanggal baru. Adapter kompatibilitas tanpa akhir bertanggal adalah mode kegagalan yang dimiliki opsi (b) secara konstruksi, dan ADR ini tidak menerimanya untuk (a).

### 7. Ditunda: Telegram (keputusan pemilik O10) dan orkestrasi notifikasi (O11)

**Telegram ditunda, belum diputuskan.** Ia bergantung pada keputusan pemilik hilir O10 (apakah dibangun sama sekali, dan untuk kelas pesan apa). ADR ini tidak menerima maupun menolaknya. Batasan tercatat _bila_ pernah dibangun, agar ADR mendatang bermula dari sini: mati secara default (flag, tanpa provider = tanpa modul); otorisasi chat eksplisit (sebuah chat diikat ke profil atau tenant lewat tindakan yang disengaja, teraudit, dapat dicabut — bot tidak boleh mengirim ke chat yang sekadar memuatnya); dan **tidak pernah menjadi fallback untuk payroll atau data pribadi** — pemberitahuan hr_payroll, apa pun yang membawa PII, dan pesan kelas `security` tidak boleh sampai ke Telegram hanya karena WhatsApp gagal. ADR semacam itu juga harus menjawab pertanyaan kebocoran kredensial dan chat grup yang ditimbulkannya; tidak ada yang dijawab di sini.

**Orkestrasi notifikasi TIDAK diterima**, menunggu kasus nilai tertulis (O11): preferensi kanal per pengguna, fallback lintas kanal ("WhatsApp gagal, kirim e-mail"), dan status lintas kanal terpadu bukan bagian kapabilitas ini. Konsekuensi yang dinyatakan eksplisit agar tidak diselundupkan: port di §8 **spesifik WhatsApp** (`WhatsappDeliveryPort`), bukan fasad multikanal `MessageDeliveryPort(channel, …)` — fasad dengan parameter kanal adalah langkah pertama orkestrasi; pemanggil yang ingin e-mail memanggil port e-mail; dan tidak ada modul di repo ini yang boleh mengimplementasikan fallback otomatis antar kanal. Port notifikasi `workflow_approval` yang ada tidak terpengaruh.

**Pembaruan (2026-10-10): jawaban pemilik dicatat, ADR ini tidak berubah.** Pemilik awcms-one menjawab O10 dan O11. **O10:** Telegram diterima sebagai adapter opsional yang mati secara default. **O11:** orkestrasi notifikasi diinginkan, dengan syarat kasus nilai tertulis dan ADR upstream. Dibaca secara setia, ini mengubah siapa yang memutuskan, bukan apa yang sudah diterima repo ini: Telegram tetap **belum diterima di sini** sampai ADR/isu sendiri ada, dan ADR itu berangkat dari batasan yang dicatat di atas (mati secara default, otorisasi chat eksplisit, tidak pernah menjadi fallback untuk payroll atau data pribadi). Orkestrasi tetap **belum diterima** sampai kasus nilai dan ADR-nya ada; port khusus WhatsApp (§8) dan aturan bahwa tak ada modul yang mengimplementasikan fallback otomatis antarkanal tetap berlaku sampai ADR semacam itu mengubahnya.

### 8. Kontrak port pengiriman (yang dipanggil booking dan hr)

Hanya bentuk; nama **sementara** dan ditetapkan oleh ADR/PR implementasi (belum ada kode). Port kapabilitas menurut ADR-0011, di `src/modules/_shared/ports/`, dengan lapisan application modul sebagai adapternya:

```ts
type WhatsappPurpose = "transactional" | "security" | "marketing";

type WhatsappRecipient =
  | { kind: "profile"; profileId: string } // diresolusi di dalam modul dari profile_identity
  | { kind: "address"; phone: string }; // langsung, mis. tamu; dinormalisasi E.164 saat masuk

type EnqueueWhatsappInput = {
  tenantId: string;
  templateKey: string; // berawalan modul, mis. "booking.reminder"; didaftarkan dengan SATU purpose
  variables: Record<string, string>; // disaring allow-list template
  recipient: WhatsappRecipient;
  idempotencyKey: string; // wajib
  correlationId?: string; // id catatan pemanggil, untuk membaca status kembali
  notBefore?: Date; // kirim terjadwal (pengingat)
  expiresAt?: Date; // wajib bila purpose template adalah "security"
};

type EnqueueWhatsappResult =
  | { status: "queued"; messageId: string }
  | { status: "duplicate"; messageId: string } // replay idempoten
  | { status: "suppressed"; reason: "hard_failure" | "opt_out" }
  | {
      status: "refused";
      reason:
        "CONSENT_REQUIRED" | "TEMPLATE_UNKNOWN" | "DISABLED" | "RATE_LIMITED";
    };

interface WhatsappDeliveryPort {
  /** Satu INSERT di dalam transaksi PEMANGGIL. Tanpa I/O jaringan. */
  enqueue(
    tx: TenantTx,
    input: EnqueueWhatsappInput
  ): Promise<EnqueueWhatsappResult>;
  /** Membaca baris outbox kembali lewat correlation id; tidak pernah disalin ke tabel pemanggil. */
  getStatusByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<WhatsappStatus[]>;
  /** Membatalkan pesan yang masih antre (booking dibatalkan sebelum pengingat). No-op setelah terkirim. */
  cancelByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<number>;
}
```

Catatan: port **tidak punya `send`**; mengirim adalah tugas dispatcher, di luar transaksi apa pun. Pemanggil tak pernah mengetahui jawaban provider secara sinkron. Pemanggil membaca status kembali dari baris outbox (pola yang dipakai awcms-one ADR-0034 D1: catatan permintaan merujuk baris outbox lewat `correlation_id`; status tidak pernah diduplikasi ke tabel pemanggil, sehingga tak bisa melenceng). Hasil `refused` dan `suppressed` dikembalikan, bukan dilempar, agar booking tak pernah di-rollback hanya karena pengingat tak bisa diantrekan.

Event sementara (AsyncAPI, oleh PR implementasi; payload hanya membawa id dan penerima ter-mask, tidak pernah nomor telepon, body, atau variabel): `whatsapp.message.queued`, `whatsapp.message.sent`, `whatsapp.message.failed`, `whatsapp.message.expired`, `whatsapp.consent.granted`, `whatsapp.consent.withdrawn`, `whatsapp.dispatch.failed` (tingkat job), mengikuti penamaan `email.message.*` / `push.dispatch.*`.

Izin sementara: `whatsapp_delivery.messages.read|cancel`, `whatsapp_delivery.suppressions.read|create|delete`, `whatsapp_delivery.consents.read|create|withdraw`, `whatsapp_delivery.templates.read`; masing-masing didaftarkan seed migrasi dalam perubahan yang sama dengan endpoint-nya (jebakan celah seed di `AGENTS.md`).

### 9. Yang harus ada sebelum implementasi dimulai

- Pemilik hilir telah menerima awcms-one ADR-0040 (Wave A item A1) — gerbang yang dinyatakan di #917.
- Issue implementasi yang menamai key modul, rentang `sql/NNN`, seed izin dan tambahan `AccessAction` (bila ada), serta berkas OpenAPI/AsyncAPI.
- Kepastian di mana consent disimpan (§10, Q1) — satu-satunya pertanyaan desain yang mengubah skema.
- Review keamanan (modul mengirim pesan berisi OTP dan menangani nomor telepon), sesuai aturan modul sensitif di `AGENTS.md`.
- Mekanisme registrasi konsumen diselesaikan di ADR-0134, sehingga booking/hr/commerce mendaftarkan template dengan cara yang sama.
- Rencana layar admin dan entri `navigation`-nya dalam perubahan yang sama (kriteria 1 ADR-0021; aturan navigasi `AGENTS.md`).
- Tes direncanakan sejak awal: allow-list template membuang variabel di luar daftar; marketing tanpa consent ditolak; consent diperiksa ulang saat dispatch; rahasia dihapus saat terminal; tanpa I/O jaringan dalam transaksi (harness yang gagal bila provider dipanggil saat transaksi terbuka); purge tak pernah menghapus baris non-terminal.

### 10. Pertanyaan terbuka

1. **Di mana consent disimpan?** Tabel `consents` milik `whatsapp_delivery` berkunci `(tenant_id, recipient_hash)`, atau catatan preferensi kontak netral-kanal milik `profile_identity` (yang dapat dipakai ulang setiap kanal mendatang, tetapi satu langkah menuju orkestrasi yang ditolak di §7)? Kecenderungan: dimiliki modul sekarang, diekstrak hanya bila kanal kedua diterima.
2. **Webhook masuk** (tanda terima pengiriman, balasan "stop"/"berhenti"): di implementasi pertama atau tindak lanjut? Tanpanya, opt-out lewat balasan dan konfirmasi pengiriman tidak ada; dengannya, modul mendapat permukaan publik tak terautentikasi (bentuk awcms-one ADR-0017 D2).
3. **Identitas pengirim**: satu nomor WhatsApp per deployment (yang dilakukan deployment ala BjekMart hari ini) atau per tenant? Kredensial tetap per deployment (§5); yang terbuka adalah apakah tenant boleh memilih _yang mana_ dari beberapa pengirim tingkat-deployment.
4. **Persetujuan template Meta**: Meta mewajibkan template yang disetujui lebih dulu untuk pesan yang dimulai bisnis di luar jendela 24 jam; registri butuh field nama/bahasa template yang disetujui, dan aturan bila tak cocok (gagal terminal, tidak pernah fallback ke teks bebas untuk `transactional`/`marketing`).
5. **Kode dispatcher bersama**: ekstrak helper lease/claim bersama sekarang, atau biarkan salinan keempat dan ekstrak di tindak lanjut? ADR ini mengizinkan keduanya; reviewer perlu bersikeras bila PR implementasi akan menyalin lebih dari query claim.
6. **Pengingat booking dalam skala besar**: pengingat yang dijadwalkan berhari-hari sebelumnya adalah baris antrean yang menunggu; pastikan indeks claim dan pengecualian "menunggu" pada purge bertahan untuk cakrawala `notBefore` yang panjang, atau putuskan pengingat di-enqueue menjelang waktu kirim oleh job booking.
7. **Reveal nomor mentah** ke admin (untuk menelepon pelanggan): diperlukan atau tidak? Default-nya tidak.
8. **O10 dan O11** dijawab pemilik pada 2026-10-10 (Telegram diterima sebagai adapter opsional yang mati secara default; orkestrasi diinginkan, dengan syarat kasus nilai); lihat catatan pembaruan di §7. Keduanya belum diterima di repo ini sampai punya ADR/isu sendiri.

## Konsekuensi

- Booking, hr_payroll, dan commerce berbagi satu antrean WhatsApp, satu set aturan provider, dan satu pemeriksaan consent. Perbaikan jalur provider mendarat sekali, di upstream.
- Repo mendapat **tabel kanal ketiga** (email, push, WhatsApp). Biayanya nyata dan diterima: satu pasang job dispatcher lagi, satu permukaan admin lagi, dan satu registrasi retensi lagi, dibatasi aturan §3 bahwa tidak ada domain menambah yang keempat.
- Commerce membawa adapter kompatibilitas **bertanggal**. Bila kondisi akhir tak terpenuhi tepat waktu, rencananya salah dan perlu ADR baru, bukan perpanjangan diam-diam.
- Tidak ada perubahan skema, API, atau event bersama ADR ini; `bun run check` tidak terpengaruh selain gerbang dokumentasi.
- Telegram dan orkestrasi tetap tak dibangun dan tak diterima; keputusan pemilik mereka (O10, O11) dilacak di hilir. Tidak ada modul stub maupun fasad multikanal yang diperkenalkan "untuk nanti".

## Alternatif yang ditolak

- **(b) Port upstream, implementasi tetap di commerce.** Ditolak di §1: arah dependensi salah, tak teruji upstream, adapter tanpa akhir alami, dan deployment hanya-booking atau hanya-hr tak punya WhatsApp.
- **WhatsApp sebagai konsumen `domain_events`.** Ditolak: handler berjalan di dalam transaksi dispatch; panggilan provider di sana melanggar ADR-0006 (ADR-0074).
- **Menambah diskriminator kanal pada `awcms_email_messages`.** Ditolak: tabel berbentuk campuran, dua dispatcher berebut, kebijakan retry e-mail bocor ke WhatsApp (penalaran ADR-0074).
- **Fasad `MessageDeliveryPort(channel, …)` generik sekarang.** Ditolak: itu orkestrasi notifikasi yang diterima lewat pintu belakang (§7, O11).
- **Antrean WhatsApp per domain** (milik booking, milik hr). Ditolak: ini persis hasil yang hendak dicegah issue; §3 menjadikannya aturan mengikat.
- **Kredensial provider dari tenant.** Ditolak karena alasan di ADR-0074 §5.
- **Consent disimpulkan dari keanggotaan segmen atau audiens kampanye.** Ditolak: §4.
