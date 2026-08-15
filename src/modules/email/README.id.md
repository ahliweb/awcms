🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:d77b8d340c1d299e62ec79dace20ed564a3be3cd868691deb2d4280d08e4dbb4 -->

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
diizinkan. Aplikasi turunan mendaftarkan kategori `derived.<name>`-nya sendiri
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
