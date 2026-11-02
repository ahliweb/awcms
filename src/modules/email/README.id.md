🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:44ccc6a21d5a61c6c7a6bc88c0f1d31fd753d8112f3678f141167556fbf287af -->

# Email

Layanan email yang dapat dipakai ulang dan netral-provider, diport dari
awcms-mini (epic #492). Infrastruktur generik — analog dengan port
object-storage milik `sync_storage` — untuk reset kata sandi, pengumuman
sistem, dan notifikasi workflow; **bukan** fitur spesifik domain "kirim struk".
Mailketing adalah _satu_ adapter, bukan alasan modul ini menjadi spesifik
domain.

Skema, RLS, antrean pengiriman, dan izin ABAC tinggal di
`sql/014_awcms_email_schema.sql`. Modul ini bergantung pada `tenant_admin`,
`profile_identity`, dan `identity_access`.

## Kontrak provider — `domain/email-provider-contract.ts`

Port `EmailProvider` (`send`, `healthCheck`) beserta DTO
`EmailMessage`/`EmailAddress`/`EmailAttachmentRef` (referensi lampiran, tidak
pernah bita mentah) dan `EmailDeliveryResult` (`retryable` membedakan kegagalan
sementara yang layak dicoba ulang dari yang permanen). Langsung analog dengan
`ObjectUploader` milik `sync-storage` — satu antarmuka, adapter konkret
diresolusi di satu tepi tunggal (`infrastructure/email-provider-resolver.ts`),
tidak pernah diimpor berdasarkan nama di tempat lain.

Panggilan provider **tidak pernah** terjadi di dalam transaksi basis data
(ADR-0006, doc 16 §Transactional outbox). Pemanggil menulis satu baris
`awcms_email_messages` di dalam transaksi bisnisnya sendiri; sebuah dispatcher
terpisah (`application/email-dispatch.ts`, `bun run email:dispatch`)
mengklaim baris dalam transaksi pendek (`FOR UPDATE SKIP LOCKED`, memakai ulang
`next_attempt_at` sebagai lease klaim), memanggil `EmailProvider.send`
**di luar** transaksi apa pun, lalu memfinalisasi ke
`sent`/`retry_wait`/`failed`/`suppressed` dan mencatat satu baris
`awcms_email_delivery_attempts`.

Lease klaim itu **dibaca kembali**, bukan sekadar ditulis (Issue #143): baris
yang ditinggalkan dalam status `sending` oleh worker yang mati di tengah pass
diklaim ulang begitu lease-nya (`EMAIL_DISPATCH_LEASE_MINUTES`) kedaluwarsa —
aturan yang sama dengan `sync-storage/application/object-dispatch.ts`. Tanpa itu,
baris semacam itu jadi limbo permanen: setiap finalisasi digerbangi
`status = 'sending'` dan `cancelEmailMessage` menolak `sending`. Trade-off yang
diterima adalah satu kemungkinan pengiriman ganda ketika crash mendarat di
antara "provider menerima" dan FINALISASI; ledger percobaan bersifat idempoten
per `(message_id, attempt_no)`, jadi klaim ulang tidak pernah bisa menggugurkan
pass. Template dicari sekali per `template_key` berbeda per pass, bukan sekali
per pesan.

### Adapter

- `infrastructure/mailketing-provider.ts` — adapter sungguhan.
  `POST {baseUrl}/api/v1/send`, form-urlencoded
  `api_token`/`recipient`/`from_email`/`from_name`/`subject`/`content`,
  respons JSON `{status, response, message_id?}`. Autentikasi hanya berbasis
  token (`EMAIL_MAILKETING_ACCOUNT_ID` adalah label operator, tidak pernah
  dikirim ke provider). Satu kiriman = satu penerima — karena itu satu baris
  `awcms_email_messages` per penerima. Kegagalan HTTP/jaringan/timeout/5xx
  bersifat `retryable: true`; penolakan bisnis `status:"failed"` bersifat
  `retryable: false`. Timeout + circuit breaker per provider
  (`getProviderCircuitBreaker("email-mailketing")`).
- `infrastructure/mailketing-v2-provider.ts` — adapter Mailketing REST API
  **v2** **opsional** (Issue #1159, ADR-0151 §1), dipilih hanya oleh
  `EMAIL_MAILKETING_API_VERSION=v2`. `POST /api/v2/send` berformat JSON; token
  dikirim **hanya** di `Authorization: Bearer` (tidak pernah di URL, query,
  body, log, atau hasil). Egress lewat `ssrfSafeFetch` ke host **tetap**
  `https://api.mailketing.co.id` (`EMAIL_MAILKETING_API_BASE_URL` harus kosong
  atau persis origin itu), dengan `maxRedirects: 0`, timeout total, dan batas
  ukuran respons. Klasifikasi (murni, `domain/mailketing-v2-contract.ts`): 200
  `success:true` = **diterima/diantre provider, belum tentu terkirim**
  (disimpan sebagai `sent`, `message_id` disimpan sebagai
  `provider_message_id`, bukan kunci idempotensi); 200 `success:false` =
  penolakan (final); 401 / 403 / 404 / 422 final; **402** = ditahan di `queued`
  15 menit tanpa menghabiskan retry dan tanpa baris attempt, dan **dibatasi**:
  setelah pesan berumur lebih dari 1 jam ia gagal dengan
  `CREDIT_HOLD_BUDGET_EXCEEDED` alih-alih tiba terlambat; **429** = coba ulang
  tidak lebih cepat dari `Retry-After` (dijepit 1 dtk sampai 1 jam); 5xx /
  timeout / jaringan / penolakan kebijakan egress = dapat diulang. **200 tanpa
  `success` boolean** (atau non-JSON) bersifat **tidak pasti**: provider mungkin
  sudah menerimanya, sehingga final, tidak pernah diulang (tanpa salinan ganda),
  dan dihitung `uncertain`. Hasil hanya berisi teks tetap
  dan kode status, tidak pernah teks body provider atau penerima. Kunci breaker
  dibagi dengan v1 (`email-mailketing`) dan menghitung kegagalan tingkat layanan,
  200 cacat, penolakan egress, 401/402/403 **dan juga penolakan**
  (`success:false`, 404/422/4xx lain): 5 berturut-turut membukanya dan sukses
  apa pun mereset, sehingga satu penerima buruk tidak memicunya tetapi nama
  field yang salah tidak bisa diam-diam menandai seluruh antrean `failed`. Health probe
  `GET /api/v2/credits` (baca-saja, tidak pernah mengirim email). **Nama field
  body kirim v2 dan semua status provider berasal dari kontrak terdokumentasi
  (v2.0.2); belum diverifikasi terhadap API live.**
- `infrastructure/log-email-provider.ts` — `EMAIL_PROVIDER=log`. Menulis satu
  baris log terstruktur (penerima dimasking, memakai ulang
  `profile-identity/domain/identifier.ts`) alih-alih memanggil provider
  sungguhan; dipakai untuk pengembangan lokal tanpa kredensial dan untuk
  pengujian. Ini **berbeda** dari `EMAIL_ENABLED=false` (dalam kasus itu
  dispatcher sama sekali tidak pernah mengklaim baris).

## Manajemen template

`template_key` sekaligus berperan sebagai kategori untuk keperluan allowlist
(`domain/email-template-categories.ts`). Enam kategori base tetap
(`auth.password_reset`, `system.announcement`, `system.security_notice`,
`system.maintenance`, `workflow.task_assigned`, `workflow.decision_required`)
ditambah `derived.transactional` masing-masing membawa daftar variabel yang
diizinkan, dan (#1044) tiga kategori
`hr.attendance_correction_{applied,rejected,cancelled}` (`userName`,
`employeeName`, `correctionDate`; tak pernah alasan) yang dikirim `hr_workforce`
lewat capability `workflow_notification` yang kini disediakan modul ini
(`application/workflow-notification-port-adapter.ts`, subjek dirender dalam
locale default tenant). Aplikasi turunan mendaftarkan kategori `derived.<name>`-nya sendiri
lewat `registerDerivedEmailTemplateCategory` sebelum dipakai; kategori tak
dikenal ditolak saat pembuatan (fail-closed).

- Kolom body bertipe `jsonb` per-locale (`{"en": "...", "id": "..."}`, doc 04
  §Konten multi-bahasa). Perenderan (`domain/email-template-render.ts`)
  meresolusi locale, menyaring variabel pemanggil melalui allowlist kategori
  (variabel yang tak terdaftar dibuang diam-diam, tidak pernah disubstitusi),
  lalu mensubstitusi token `{{key}}` — di-escape HTML hanya untuk `htmlBody`.
- Validasi (`domain/email-template-validation.ts`) menegakkan format
  `templateKey` + kategori yang dikenal, adanya entri `en` pada setiap teks
  terlokalisasi, kode locale 2 huruf, dan menolak `htmlBodyTemplate` yang memuat
  `<script>`/`<iframe>`/penangan event inline/`javascript:` (pertahanan berlapis
  di atas escaping saat render).
- CRUD + soft-delete/restore + pratinjau:
  `POST/GET/PATCH/DELETE /api/v1/email/templates[/{id}]`,
  `POST /api/v1/email/templates/{id}/restore` (aksi khusus),
  `POST /api/v1/email/templates/{id}/preview` (merender dengan data sampel
  sintetis — tidak pernah alamat penerima sungguhan, tidak pernah menyentuh
  antrean).
- Salinan template bawaan (EN+ID) untuk kategori base tinggal di
  `domain/email-default-templates.ts`; `seedDefaultEmailTemplates`
  menyisipkannya untuk satu tenant (idempoten — tidak pernah menimpa kustomisasi
  tenant), dijalankan lewat
  `bun run email:templates:seed-defaults -- --tenant=<id> --actor=<tenantUserId>`.

## Alur kerja pengumuman / notifikasi

`POST /api/v1/email/announcements` (enqueue yang mampu massal) dan
`.../preview` (dry-run) —
`application/announcement-directory.ts` + `domain/announcement-validation.ts`.

- **Penargetan** — `{type:"users", userIds}` (eksplisit, diikat lewat
  `tx.array(ids,"uuid")`), `{type:"role", roleId}`, atau `{type:"tenant"}`.
  Setiap target hanya meresolusi identitas yang **aktif** dan selalu
  mengecualikan siapa pun yang ada di `awcms_email_suppression_list`.
- **ABAC dua tingkat** — `email.notification.create` dibutuhkan untuk setiap
  request; `target.type = "role"|"tenant"` (tak terbatas) **selain itu**
  membutuhkan `email.announcement.create`.
- **Idempotensi wajib** — `Idempotency-Key` selalu dituntut (memakai ulang
  `_shared/idempotency.ts`).
- **Pratinjau itu aman** — hanya mengembalikan `matchedCount` + satu sampel
  sintetis yang dirender; tidak pernah daftar/alamat penerima, tidak pernah
  menyentuh antrean.
- Satu baris `awcms_email_messages` per penerima yang berbagi satu
  `correlation_id`; subjek dirender per penerima saat enqueue. Audit adalah satu
  baris per request (`announcement_sent`) berisi hitungan saja, tidak pernah
  daftar penerima.
- **Terbatas + ter-batch** (Issue #153) — target `role`/`tenant` meresolusi
  paling banyak `ANNOUNCEMENT_MAX_RECIPIENTS` (5000) baris, terurut secara
  deterministik, dan di-enqueue dengan INSERT `unnest` multi-baris sebesar 500
  baris masing-masing alih-alih satu INSERT per penerima. Menyentuh batas atas
  mengembalikan `truncated: true` dari `enqueueAnnouncement` dan mencatat
  `email.announcement.recipients_truncated` pada level `warning` — menjangkau
  audiens yang lebih besar dari batas itu butuh job enqueue asinkron, yang belum
  ada.

## Observabilitas & operasional

- **Diagnostik antrean** — `GET /api/v1/email/messages?status=...`
  (`email.message.read`), berpaginasi keyset, hanya `to_address_masked`.
- **Pembatalan** — `POST /api/v1/email/messages/{id}/cancel`
  (`email.message.cancel`); hanya `queued`/`retry_wait` yang bisa dibatalkan
  (mitigasi untuk pengiriman massal tak sengaja).
- **Daftar supresi** — `GET/POST /api/v1/email/suppressions`,
  `DELETE /api/v1/email/suppressions/{id}`
  (`email.suppression.{read,create,delete}`). Dispatcher memeriksa ulang supresi
  tepat sebelum mengirim, jadi penerima yang disupresi setelah enqueue tetap
  dikecualikan (langsung dipindah ke `suppressed`, tanpa percobaan pengiriman).
- **Gangguan provider** — circuit breaker terbuka setelah 5 kegagalan
  beruntun; dispatcher berhenti mengklaim (`email.dispatch.breaker_open`) dan
  menguras otomatis begitu ia tertutup. Karena panggilan provider secara ketat
  berada di luar transaksi basis data apa pun, gangguan email tidak pernah
  memblokir penulisan yang tak berkaitan.
- **Log terstruktur** — setiap tahap siklus hidup adalah satu baris log JSON
  yang membawa `correlationId`/`tenantId`/`moduleKey`, tidak pernah penerima
  mentah: `email.message.queued`, `email.dispatch.claimed`,
  `email.dispatch.sent`, `email.dispatch.retry_scheduled`,
  `email.dispatch.failed`, `email.dispatch.suppressed`,
  `email.dispatch.breaker_open`, `email.message.cancelled`. Baris
  queued/sent/failed/suppressed/cancelled juga merupakan kanal AsyncAPI yang
  terdokumentasi (`asyncapi/awcms-domain-events.asyncapi.yaml`) — kontrak saja,
  logger terstruktur adalah produsennya (konvensi yang sama dengan
  `awcms.database.pool.saturated`; tidak ada bus pub/sub hidup di repo ini).

## Konfigurasi

| Var                             | Wajib           | Bawaan  | Fungsi                              |
| ------------------------------- | --------------- | ------- | ----------------------------------- |
| `EMAIL_ENABLED`                 | –               | `false` | Mengaktifkan modul email            |
| `EMAIL_PROVIDER`                | saat aktif      | –       | `"mailketing"` atau `"log"`         |
| `EMAIL_FROM_ADDRESS`            | saat aktif      | –       | Alamat pengirim bawaan              |
| `EMAIL_FROM_NAME`               | –               | `AWCMS` | Nama pengirim bawaan                |
| `EMAIL_SEND_TIMEOUT_MS`         | –               | `10000` | Timeout kirim per percobaan         |
| `EMAIL_SEND_MAX_RETRIES`        | –               | `5`     | Batas coba ulang sebelum `failed`   |
| `EMAIL_MAILKETING_ACCOUNT_ID`   | saat mailketing | –       | Label operator (tak pernah dikirim) |
| `EMAIL_MAILKETING_API_TOKEN`    | saat mailketing | –       | Token API Mailketing (rahasia)      |
| `EMAIL_MAILKETING_API_BASE_URL` | saat mailketing | –       | URL basis API Mailketing            |
| `EMAIL_MAILKETING_API_VERSION`  | –               | `v1`    | `v1` (bawaan) atau `v2`             |
| `EMAIL_MAILKETING_V2_VERIFIED`  | –               | kosong  | Flag pengakuan tahap 2              |

**v2 produksi BELUM disetujui** sampai pemeriksaan live tahap 2 (nama field body
kirim, skema auth, bentuk `/credits`) selesai. Selama
`EMAIL_MAILKETING_V2_VERIFIED=true` belum disetel, `config:validate`,
`email:provider:health`, `email:dispatch` dan setiap putaran dispatch mencetak/
mencatat "Mailketing v2 contract UNVERIFIED". Flag itu hanya membungkam
peringatan; tidak mengubah perilaku.

**Kesalahan konfigurasi tidak pernah menggagalkan pesan.** Token hilang, versi
tak dikenal, base URL buruk, atau token yang tak bisa jadi nilai header membuat
resolver mengembalikan provider yang pengirimannya _ditunda_ (`skipped`): claim
dibatalkan, baris tetap `queued` (ditahan 5 menit), tanpa baris attempt dan
tanpa menghabiskan retry. `email:dispatch` mencatat
`email.dispatch.misconfigured`, mencetak `misconfigured=N` plus baris
`CONFIGURATION ERROR` dan keluar non-nol; setelah konfigurasi diperbaiki antrean
terkuras. Ini juga mencakup kasus token-hilang v1 yang sudah ada.

`EMAIL_MAILKETING_API_VERSION` bersifat fail-closed: kosong = `v1`; nilai selain
persis `v1`/`v2` adalah kesalahan konfigurasi (resolver mengembalikan provider
yang menolak setiap pengiriman, `config:validate` melaporkannya) — tidak pernah
dibaca diam-diam sebagai `v1`. Dengan `v2`, `EMAIL_MAILKETING_API_BASE_URL`
harus kosong atau persis `https://api.mailketing.co.id`; v1 tetap memakai base
URL yang dapat dikonfigurasi.

### Rollout dan rollback Mailketing v2 (ops)

v1 tetap bawaan sampai pemilik membalikkannya (ADR-0151 tahap 0–3); perubahan
ini hanya menghadirkan tahap 1 (adapter ada, nonaktif secara bawaan).

1. Setel `EMAIL_MAILKETING_API_VERSION=v2` di lingkungan non-produksi dengan
   pengirim uji, jalankan `bun run config:validate`, `bun run email:provider:health`
   (`GET /credits` baca-saja), lalu kirim pesan uji sungguhan dan **verifikasi
   nama field request serta status terhadap API live** — belum dilakukan.
2. Pasang `ops/awcms-jobs.env-global` terbaru di samping `ops/run-job.sh`.
3. **Rollback:** hapus variabelnya (atau setel `v1`) lalu restart proses
   web/jobs. Tidak ada isi outbox yang spesifik versi, sehingga baris antrean
   berlanjut.
4. `email:dispatch` mencetak `uncertain=N`: pesan yang dikirim ulang setelah
   lease kedaluwarsa mungkin sudah diterima provider sebelum worker mati
   (kemungkinan duplikat, trade-off ADR-0151 yang terdokumentasi; tidak ada
   dedupe di sisi provider), plus 200 tanpa `success` boolean. Catatannya
   ditulis ke `last_error` untuk setiap hasil baris itu (sent, retried, failed,
   deferred); hanya baris yang benar-benar dikirim ke provider yang dihitung. Email OTP / reset password memakai antrean yang sama dan tidak
   berubah.
5. Rentetan 401/402/403 membuka breaker (5 berturut-turut) dan dispatcher
   berhenti meng-claim sampai menutup; perbaiki token, kredit, atau pengirim,
   lalu cek `bun run email:provider:health`.

Semua nilai di `.env.example` adalah placeholder, tidak pernah kredensial
sungguhan. Ketika `EMAIL_ENABLED=false` (bawaan) tak ada yang memblokir
aplikasi: pesan tetap duduk di outbox dan terkuras begitu modulnya diaktifkan
saat online — deployment offline/LAN berjalan penuh tanpa email.

## Perilaku saat nonaktif / offline-LAN

`EMAIL_ENABLED=false` tidak boleh menghentikan aplikasi atau jalur bisnis apa
pun. `dispatchEmailQueue` langsung kembali tanpa mengklaim baris apa pun — bukan
"coba lalu gagal", ia memang tidak mencoba. Pesan yang mengantre diproses pada
jalannya berikutnya begitu modulnya diaktifkan.

## Subset yang diport / pembuangan disengaja vs awcms-mini

- Alur reset kata sandi (`/api/v1/auth/password/*`) tinggal di
  `identity_access` di mini dan **bukan** bagian dari port modul email ini —
  kontrak outbox tersedia baginya untuk meng-enqueue ketika alur itu diport.
- `GET /api/v1/reports/email-health` dan gerbang konfigurasi provider
  `security:readiness` **dibuang** di sini — modul `reporting` dan skrip
  `security:readiness` belum ada di repo ini. Data setaranya tersedia lewat
  `GET /api/v1/email/messages?status=...`.
- Uji integrasi terhadap PostgreSQL hidup bukan bagian dari suite pengujian repo
  ini; uji yang diport adalah uji unit domain-murni.

## Skill terkait

`awcms-integration` (outbox/coba ulang/circuit breaker), `awcms-sensitive-data`
(normalisasi/hash/masking), `awcms-idempotency`, `awcms-abac-guard`,
`awcms-audit-log`.

## Runtime Bun email / status UI terencana

`bun run email:dispatch` sudah berupa worker antrean Bun melalui API provider di luar transaksi DB. Kampanye/Mailketing multi-akun dan status real-time mendatang wajib memakai Bun; WebSocket/SSE hanya untuk tampilan progres, bukan mengirim email. [Standar runtime](../../../docs/awcms/bun-delivery-realtime-runtime.id.md).
