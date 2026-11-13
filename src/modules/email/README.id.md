🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:1c00293e19baa31f6c498b29dc8378d026f18caf7d1a67cc0612bc31c1ae0056 -->

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

## Akun Mailketing tenant dan pengirim terverifikasi (Issue #1160, ADR-0151 §2)

Setiap tenant (atau brand, sebagai business scope) dapat menghubungkan **N akun
Mailketing** dan mengirim dari **N alamat pengirim terverifikasi** per akun, di
**antrean tunggal yang sama** (`awcms_email_messages`, `email:dispatch`). Tidak
ada antrean kedua, tidak ada mailer per akun atau per kampanye, dan tidak ada
token di JSON pengaturan atau di browser.

- **Model (registry #1140).** Akun Mailketing adalah akun `channel_accounts`
  `mailketing`/`esp_account` (kontainer) yang token API-nya baris
  `channel_secrets` (terenkripsi amplop, dirujuk lewat id, tidak pernah
  dikembalikan). Setiap alamat pengirim adalah anak `mailketing`/`sender_identity`
  yang `external_id`-nya alamat itu; ia tidak menyimpan kredensial dan meminjam
  token induknya hanya selama induk `connected`. Kapabilitas (`dm` untuk email
  transaksional) diberikan dengan bukti lewat rute `channel_accounts` yang ada.
- **Terverifikasi berarti provider yang menyatakannya.**
  `bun run email:senders:verify` (sebagai `awcms_app`) memanggil
  `GET /api/v2/credits` dan `GET /api/v2/senders` yang hanya-baca per akun dan
  mencatat health: pengirim yang terdaftar terverifikasi menjadi `connected`;
  yang tidak terdaftar `degraded`/`SENDER_UNVERIFIED`; respons yang tak
  dikenali, atau entri yang saling bertentangan untuk satu alamat, `unknown`;
  401 mengeluarkan akun dari layanan; probe yang tak mempelajari apa pun tidak
  menulis apa pun (faktanya menjadi basi); hasil dibuang bila token akun diganti
  selama probe berjalan. **Job ini dijadwalkan per jam di crontab yang
  di-generate** (`0 * * * *`, ADR-0162), sebagai pengecualian `awcms_app`
  bernama (ia menulis health channel-account, yang hanya boleh `awcms_app`;
  pengecualiannya terdaftar di `APP_ROLE_SCHEDULED_EXCEPTIONS` dan diuji dua
  arah). Ia tetap no-op kecuali `EMAIL_SENDER_ROUTING_ENABLED` bernilai `true`.
  Ia harus terus berjalan lebih sering dari
  `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` (360): tanpa jalannya, setiap pengirim
  tenant menjadi basi setelah 360 menit, emailnya ditahan lalu GAGAL
  (`SENDER_HOLD_BUDGET_EXCEEDED`) satu jam setelah enqueue; tidak ada yang
  dialihkan ke pengirim deployment. Repo ini **tidak
  membuat atau memverifikasi domain di Mailketing**: API terdokumentasi tidak
  menyediakan panggilan itu. SPF/DKIM/DMARC diatur orang di DNS tenant dan di
  provider; hanya putusan provider yang dibaca.
- **Enqueue.** `POST /api/v1/email/announcements` menerima `senderAccountId` /
  `businessScope` opsional. Pengirim adalah yang eksplisit, jika tidak default
  prospektif scope itu (atau tenant-wide) (`PUT /api/v1/email/sender-policy`,
  `email.sender_policy.configure`, berisiko tinggi, idempoten, diaudit), jika
  tidak pengirim deployment. Setiap kali hasilnya pengirim TENANT (disebut, atau
  dipilih kebijakan, termasuk tenant-wide) atau business scope disebut, pemanggil
  butuh `email.senders.use` DAN aturan akses channel-account pada pengirim itu
  (assignment, scope); kebijakan menentukan brand mana yang berbicara, bukan
  mengizinkan setiap pengirim surel berbicara atas namanya. Pengirim tenant
  wajib milik akun Mailketing yang business scope-nya mencakup scope-nya
  (ditegakkan saat registrasi, setiap peminjaman token, dan oleh trigger).
  Pengirim terpilih, alamat terverifikasi dan nama tampilannya, versi kebijakan,
  dan business scope **di-snapshot tak-berubah** di setiap baris (`sql/346`,
  ditegakkan trigger untuk semua role). Pengirim yang tak bisa mengirim adalah
  `422 SENDER_UNAVAILABLE` (satu jawaban untuk tak dikenal, tenant lain, belum
  terverifikasi, dinonaktifkan, atau di luar scope), tidak pernah ditukar.
- **Email keamanan tetap di pengirim deployment** (ADR-0151 Q7): `auth.*` dan
  `system.security_notice` mendapat `purpose = 'security'`, dan database
  menolak pengirim tenant pada keduanya.
- **Dispatch.** Jalur deployment tidak berubah. Setiap pengirim tenant punya
  jalurnya sendiri: dinilai ulang setiap putaran untuk tenant baris; ditahan
  saat verifikasinya atau kredit akunnya basi, tak diketahui, atau di bawah
  `EMAIL_MAILKETING_CREDIT_FLOOR`; diklaim di bawah batas per jam
  (`EMAIL_SENDER_RATE_PER_HOUR`, advisory lock per pengirim); dikirim lewat
  provider v2 dengan token akun itu (didekripsi di memori, `sql/348` hanya
  membolehkan worker melihat token milik `esp_account` yang CONNECTED;
  `security:readiness` mem-pin policy itu persis dan mem-probe-nya) dan breaker
  akun itu sendiri (`email-mailketing:account:<id>`), DARI alamat snapshot
  baris. Penahanan dibatasi (`SENDER_HOLD_BUDGET_EXCEEDED` satu jam setelah
  enqueue, juga untuk baris yang menunggu tak diklaim karena routing dimatikan,
  breaker akun terbuka, atau batas per jam tercapai);
  pengirim yang dicabut, dinonaktifkan, atau milik tenant lain gagal dengan
  `SENDER_UNAVAILABLE`. **Tidak ada rotasi otomatis** antarpengirim atau
  antarakun.
- **Kompatibilitas mundur.** `EMAIL_SENDER_ROUTING_ENABLED` mati secara bawaan:
  jalur satu-akun via env (`EMAIL_MAILKETING_API_TOKEN`, `EMAIL_FROM_ADDRESS`)
  tetap bekerja persis sama, pengirim yang disebut ditolak
  (`409 SENDER_ROUTING_DISABLED`), dan baris pengirim tenant tidak pernah
  diklaim. Peralihan = menyalakan flag setelah akun dan pengirim terverifikasi;
  rollback = mematikannya (tak ada data yang disalin; baris tenant yang
  mengantre menunggu, dan gagal begitu berumur satu jam).
- **Bukan di sini:** layar admin (#1162; permission-nya sudah di-seed dan
  ditegakkan API), purpose marketing dan gerbang persetujuannya (CHECK
  `purpose` hanya menerima `transactional`/`security`). Webhook: lihat bagian
  berikutnya (#1161).

Keputusan terbuka (pilihan fail-closed diambil, perlu konfirmasi maintainer):
bentuk respons live `/senders` dan `/credits` belum diverifikasi (parser hanya
menerima `verified: true` / `status: "verified"` eksplisit dan saldo numerik);
`email:senders:verify` berjalan sebagai `awcms_app` di crontab (ADR-0162;
memindahkannya ke role database khusus adalah keputusan terbuka O1 di sana); 401/403 saat kirim tidak langsung menurunkan status akun (worker tak bisa menulis
health; breaker per akun menghentikan jalur dan putaran verify berikutnya
mencatatnya); notifikasi workflow tidak memakai kebijakan default (hanya
pengumuman).

## Webhook Mailketing: karantina, presedensi suppression (Issue #1161)

ADR-0151 bagian 5, **mode `strict`**. Mati secara bawaan
(`EMAIL_WEBHOOK_ENABLED`).

**Bukti vendor (diverifikasi ulang 2026-11-11).** Dokumentasi resmi
(<https://api.mailketing.co.id/docs/webhook.html>,
<https://api.mailketing.co.id/docs/>, v2.0.2) menjelaskan callback `POST`
JSON, satu URL per jenis event yang diatur di dasbor Mailketing, dengan payload
`emailopen` (`email`, `date`, `message_id`), `emailclick` (`email`,
`link_clicked`, `date`, tanpa id), `bounce` (`email`, `reason`, `date`,
`message_id`), `newsubscriber` (`email`, nama, `list_id`, `mobile`, `date`),
`unsubscribe` (`email`, `date`, tanpa id) dan `delivered` khusus Business API
(`send_time`, `orig`, `rcpt`, `jobid`, `dsndiag`). Dokumentasi itu **tidak
menjelaskan autentikasi apa pun**: tanpa tanda tangan atau HMAC, tanpa header
rahasia, tanpa token, tanpa daftar IP sumber, tanpa mTLS, tanpa id event; dan
tanpa endpoint status pesan, unsubscribe, atau suppression untuk memverifikasi
ulang laporan. Jadi tidak ada yang bisa membedakan callback asli dari yang
dipalsukan, dan rancangan "verifikasi dengan menarik dari vendor" tidak punya
apa pun untuk ditarik.

Yang dibangun, fail-closed:

- **URL callback per akun Mailketing.** `POST /api/v1/email/webhook-callbacks`
  (`email.webhook.configure`, berisiko tinggi, idempoten, teraudit) menerbitkan
  atau merotasi
  `/api/v1/email/webhooks/mailketing/mkw1.<tenantId>.<callbackId>.<secret>`
  (secret 256-bit), ditampilkan sekali. Ia adalah webhook subscription
  `channel_accounts` (`verification_mode = 'unauthenticated'`); yang disimpan
  hanya SHA-256 yang terikat ke tenant dan id callback. Penerbitan mencabut URL
  sebelumnya; revoke (`.../{id}/revoke`), memutus atau menghapus akun langsung
  menghentikannya. URL itu **menemukan** akun, bukan mengautentikasi Mailketing
  (ADR-0150 N5).
- **Intake** (`application/mailketing-webhook-handler.ts`). 404 saat mati.
  Setiap permintaan dibebankan ke bucket per alamat untuk pembuktian yang GAGAL
  (30/menit) sebelum parsing atau kerja database apa pun, dan bebannya
  dikembalikan begitu permintaan terverifikasi: Mailketing memanggil URL semua
  tenant dari sedikit alamat bersama, jadi trafik sah tidak pernah memenuhi
  bucket bersama itu (satu tenant tidak bisa membuat tenant lain kena 429),
  sementara alamat yang terus gagal ditolak tanpa query. Lalu bentuk token dan
  batas 32 KiB; token diverifikasi dengan waktu konstan di dalam tenant yang
  disebutnya (tenant aktif, `email` aktif, callback hidup, akun `connected`),
  satu `401` untuk setiap kegagalan; lalu bucket per CALLBACK untuk trafik
  terverifikasi (`EMAIL_WEBHOOK_RATE_PER_MINUTE`). Penolakan dihitung dan
  diaudit agregat di tenant platform. Terdaftar di
  `SESSION_FREE_BODY_ENDPOINTS`.
- **Pengikatan.** Event disimpan hanya bila menyebut pesan `sent` yang dikirim
  tenant INI lewat sender identity milik akun INI: lewat provider message id
  yang kami simpan saat diterima DAN penerimanya (`bounce`, `emailopen`,
  `delivered`), atau, untuk `emailclick`/`unsubscribe` (payload tanpa id), lewat
  penerima yang dikirimi akun ini dalam 30 hari terakhir. Id milik tenant atau
  akun lain, atau penerima yang tidak cocok, dibuang. `newsubscriber` tidak
  pernah disimpan dan tidak pernah menciptakan subscriber atau persetujuan.
- **Batas banjir.** Cap waktu provider diurai ketat: bentuk tanpa zona yang
  didokumentasikan vendor `YYYY-MM-DD HH:MM:SS` (dibaca sebagai UTC, dengan
  toleransi masa depan 14 jam untuk nilai WIB/WITA/WIT) atau ISO-8601 dengan
  zona eksplisit; selain itu, tanggal lebih dari 30 hari lalu atau terlalu jauh
  di masa depan dibuang sebagai basi. Dedupe mengabaikan cap waktu itu, jadi
  URL yang sah tidak bisa mencetak baris dengan memvariasikannya: satu baris
  per (akun, jenis, pesan) untuk bounce, open, dan delivered, satu per (akun,
  jenis, penerima, hari UTC) untuk click dan unsubscribe, dan paling banyak
  SATU unsubscribe pending per penerima (indeks unik). Paling banyak
  `EMAIL_WEBHOOK_MAX_PENDING` (bawaan 5000) event pending per tenant: melewati
  itu, bounce dan unsubscribe berikutnya TIDAK dicatat (dihitung sebagai
  `quotaExceeded`, dicatat di log warning) sampai operator meninjau antrean.
  Itu fail-closed untuk mode ini: mode strict tidak bertindak apa pun dengan
  sendirinya, jadi tidak ada yang hilang, dan antrean yang sudah menunggu tidak
  tertimbun.
- **Karantina, bukan state.** Event masuk ke `awcms_email_provider_events`
  (`sql/379`), selalu `authenticity = 'unauthenticated'`, penerima sebagai hash
  dan mask, alasan bounce diringkas menjadi hard/soft/unknown dan kode RFC 3463,
  klik menjadi host tautan dan hash (tidak pernah disimpan, dirender sebagai
  tautan, atau diambil). Tidak ada status pesan, suppression, subscriber,
  persetujuan, atau pelanggan yang berubah. Imutabel kecuali satu kali review;
  `received_at` adalah jam database.
- **Review operator.** `GET /api/v1/email/provider-events` (`email.webhook.read`)
  menampilkan karantina; dengan `emailMessageId` ditambah proyeksi yang
  dilaporkan provider (`accepted` < `delivered` < `bounced`, maksimum atas
  event pesan itu, jadi hanya maju; tidak pernah ditulis ke pesan; tidak ada
  `complained` karena Mailketing tidak melaporkannya).
  `POST /api/v1/email/provider-events/{id}/review`
  (`email.provider_events.approve`, berisiko tinggi, idempoten, diaudit hanya
  dengan id; orang yang login dan akses operator atas akun event itu menurut
  aturan `channel_accounts`, selain itu 404 yang sama) mengonfirmasi bounce
  (hard; soft/unknown hanya setelah penerima soft-bounce pada
  `EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD`, bawaan 3, pesan BERBEDA dalam 30 hari:
  pengulangan tentang satu pesan dihitung sekali) atau
  unsubscribe ke daftar suppression dengan `source = 'provider_report'`, atau
  mengabaikannya. Satu suppression per penerima, jadi bounce dan unsubscribe
  untuk satu orang tidak saling berpacu.
- **Presedensi suppression (ADR-0151 bagian 4), saat enqueue DAN dispatch**
  (`domain/suppression-policy.ts`):

  | Entri                                          | transactional | security  |
  | ---------------------------------------------- | ------------- | --------- |
  | `operator` `manual` / `bounced` / `complained` | diblokir      | diblokir  |
  | `operator` `unsubscribed`                      | diblokir      | diizinkan |
  | `provider_report` (alasan apa pun)             | diblokir      | diizinkan |

  Opt-out marketing tidak pernah menghentikan reset kata sandi, undangan, atau
  pemberitahuan keamanan, dan laporan provider yang tidak terautentikasi juga
  tidak.

- **Email keamanan hanya dikirim oleh sistem.** Karena pengecualian itu ada,
  pesan `security` harus pesan yang diputuskan sistem untuk dikirim. Rute
  pengumuman (`POST /api/v1/email/announcements`, `.../preview`) tidak lagi
  menerima template auth/keamanan (`auth.*`, `system.security_notice`):
  `422 TEMPLATE_CATEGORY_RESERVED`. Sebagai pertahanan berlapis,
  `enqueueAnnouncement` dan `enqueueDirectAddressEmail` melempar
  `SecurityMailNotPermittedError` untuk kategori keamanan kecuali pemanggil
  menyerahkan `SECURITY_MAIL_GRANT` (`application/security-mail-grant.ts`), yang
  hanya dipegang port notifikasi auth internal (dipin oleh tes).
- **Retensi.** `email:queue:purge` menghapus event yang sudah direview dan
  informasional setelah 90 hari dan yang pending setelah 365 (dijaga legal
  hold, deskriptornya sendiri; `--dry-run` ikut menghitungnya). Tiga lapis
  menjaga sisanya: `awcms_app` tidak punya DELETE pada tabel itu; policy
  RESTRICTIVE menolak worker untuk apa pun yang lebih muda dari 30 hari, atau
  baris pending yang lebih muda dari 365; dan trigger BEFORE DELETE menolak
  baris yang sama untuk SETIAP role (owner, atau deployment satu-role yang tidak
  terikat policy). `security:readiness` mem-pin policy dan kedua trigger pada
  teks persisnya dan memprobe lantai itu sebagai `awcms_worker` pada baris
  bertanggal mundur dalam transaksi yang di-rollback. Tenant yang gagal tidak
  lagi menghentikan purge untuk tenant lain.

Keputusan terbuka (pilihan fail-closed diambil, perlu konfirmasi maintainer):

- **Q1 / Q6 ADR-0151 tetap terbuka.** Hanya `strict` yang ada;
  `restrictive-only` (suppression otomatis pada bounce atau unsubscribe yang
  terikat pesan) dan `authenticated` butuh keputusan ADR, dan vendor belum
  dimintai tanda tangan, daftar IP sumber, atau id event dalam perubahan ini.
- **`unsubscribed` masih memblokir email transaksional.** Aturan 2 ADR-0151
  membolehkan unsubscribe hanya menghentikan `marketing`, tetapi purpose
  `marketing` belum ada, sehingga hari ini itulah satu-satunya cara seseorang
  menghentikan pengumuman tenant. Penyempitannya milik issue kampanye yang
  menambah `marketing` dan gerbang persetujuannya.
- **Opt-out newsletter tidak dipropagasi.** Unsubscribe yang dikonfirmasi
  men-suppress alamat di `email`; ia tidak mengubah subscriber `newsletter`
  (ADR-0103 pemilik persetujuan) dan tidak ada yang dipanggil di Mailketing
  (API-nya tidak ada).
- **Pengirim deployment tidak mendapat callback.** Ia tidak punya akun untuk
  diikat, dan mengikat lewat id provider lintas tenant adalah hal yang ditolak
  di sini.
- **Unsubscribe yang dikonfirmasi berlaku untuk seluruh tenant.** Daftar
  suppression berkunci (tenant, penerima), jadi unsubscribe yang dilaporkan
  lewat akun Mailketing SATU brand, setelah dikonfirmasi operator, menghentikan
  email transaksional tenant itu ke orang tersebut dari SEMUA brand (tidak
  pernah email keamanan). Aman-gagal arahnya (hanya menghentikan email), tetapi
  lebih luas dari opt-out per brand; keputusan serupa untuk persetujuan
  marketing WhatsApp adalah #1231 M4. Cakupan per brand butuh perubahan kunci
  suppression dan sebuah keputusan.
- **Cap waktu provider tanpa zona diterima.** Audit meminta ISO-8601 dengan zona
  eksplisit; payload Mailketing yang didokumentasikan tidak membawanya
  (`2026-08-18 10:30:00`), jadi bentuk persis itu diterima sebagai UTC dengan
  toleransi masa depan yang lebar. Bentuk lain apa pun dibuang sebagai basi.
- Layar admin adalah Issue #1162 (permission tercatat di `NOT_YET_SCREENED`).
  Tidak ada channel AsyncAPI yang ditambah: tidak ada yang menerbitkan domain
  event di sini.

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
