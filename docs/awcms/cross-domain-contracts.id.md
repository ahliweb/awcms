🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](cross-domain-contracts.md)

<!-- i18n-source-hash: sha256:2831a2faf61318b26a20f967db7506cd17e94612d75d5bb9aece84c922e23284 -->

# Kontrak lintas-domain — capability port, event provisional, dan idempotensi consumer

> **Status:** port booking dan sembilan event-nya sudah **dibangun** (Issue
> #941); port ketersediaan staf (#946) serta port WhatsApp dan tujuh event-nya
> (#963) dibangun sebelumnya. Yang masih desain adalah event `hr` (masih di
> dokumen AsyncAPI **provisional** yang terpisah dan tervalidasi mesin serta
> bukan bagian dari kontrak live) dan consumer di bagian 6. Berkas
> `_shared/ports/*.ts` dibuat oleh PR implementasi fase 1 masing-masing modul
> (port tanpa implementasi adalah kode mati yang harus dihapus reviewer).
>
> Dokumen ini adalah sambungan empat keputusan: paket booking
> ([ADR-0131](../adr/0131-generic-booking-module-admission.md),
> [`booking.md`](booking.md)), keluarga `hr_payroll` ([ADR-0132](../adr/0132-hr-payroll-module-family-admission.md), [`hr-payroll.md`](hr-payroll.md), Issue #916),
> kapabilitas pengiriman WhatsApp
> ([ADR-0133](../adr/0133-generic-delivery-capability-whatsapp-promotion.md)),
> dan registrasi consumer yang dideklarasikan di descriptor ([ADR-0134](../adr/0134-descriptor-declared-domain-event-consumers.md), Issue #918
> butir 1). Bila sebuah port _didefinisikan_ di tempat lain, dokumen ini
> menyatakan ulang kontraknya agar ketiganya bisa ditinjau berdampingan; ADR
> pemiliknya menang bila ada perbedaan, dan perbedaan itu adalah cacat yang harus
> dilaporkan.

## 1. Apa yang dikontrakkan di sini, dan apa yang tidak

| Artefak                                                                               | Status           | Lokasi                                                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Port booking (`quote`, `hold`, `confirm`, `cancel`, `reschedule`)                     | **built** (#941) | §3                                                                                                                                  |
| Port ketersediaan staf (`getAvailability`)                                            | **built** (#946) | §4                                                                                                                                  |
| Port pengiriman WhatsApp (`enqueue`, `getStatusByCorrelation`, `cancelByCorrelation`) | **live** (#963)  | §5                                                                                                                                  |
| 6 skema event provisional (hr); 7 event whatsapp dan 9 event booking sudah **live**   | **provisional**  | [`asyncapi/provisional/…provisional.asyncapi.yaml`](../../asyncapi/provisional/awcms-cross-domain-events.provisional.asyncapi.yaml) |
| Registrasi consumer (`ModuleDescriptor.domainEventConsumers`)                         | ADR-0134         | tidak dinyatakan ulang; dokumen ini hanya _memakainya_                                                                              |
| Idempotensi per consumer ber-efek-samping                                             | desain           | §6                                                                                                                                  |
| Bagaimana sebuah event berpindah dari provisional ke live                             | proses           | §7                                                                                                                                  |

Tidak dikontrakkan di sini: skema, endpoint, permission, dan state machine modul
itu sendiri. Semuanya ada di paket dan ADR di atas dan tidak diduplikasi.

## 2. Aturan yang berlaku untuk ketiga port

Ini adalah ADR-0011 (consumer bergantung pada port netral, tidak pernah pada kode
modul), ADR-0006 (tidak ada I/O jaringan di dalam transaksi database) dan
ADR-0063 (otorisasi di chokepoint), diterapkan sekali, bukan tiga kali.

- **Di mana port tinggal.** Interface TypeScript murni di
  `src/modules/_shared/ports/<name>-port.ts` yang tidak mengimpor apa pun dari
  modul mana pun. Adapter-nya hidup di lapisan `application/` modul **pemilik** dan
  disuntikkan oleh **composition root consumer** (route atau job-nya). Berkas itu
  dibuat oleh PR fase 1 modul pemilik bersama adapter dan pemanggil pertamanya;
  **PR ini tidak membuat satu pun**.
- **Konteks tenant dan RLS.** Setiap panggilan berjalan di transaksi ber-scope
  tenant milik pemanggil (`tx`) atau menerima `tenantId` dan membuka konteks
  tenant sendiri; keduanya berarti FORCE RLS berlaku dan port tidak pernah bisa
  menjangkau baris tenant lain. Port tidak pernah menerima tenant id yang lalu
  dipercaya melebihi milik sesi.
- **Otorisasi.** Port **tidak mengotorisasi dan tidak mengaudit apa pun**; route
  consumer mengotorisasi permission-_nya sendiri_ sebelum memanggil (seperti yang
  didokumentasikan `InventoryLedgerPort`). Modul pemilik mengaudit perubahan
  state-nya sendiri di dalam adapter.
- **Tanpa I/O jaringan dalam transaksi.** Tidak ada metode port yang memanggil
  provider, webhook, atau layanan lain. Apa pun yang harus keluar dari proses
  lewat outbox dan dikirim oleh dispatcher di luar transaksi. Satu-satunya tulis
  yang dilakukan port pengiriman adalah satu `INSERT` di transaksi pemanggil.
- **Penolakan adalah nilai.** Penolakan domain (`SLOT_UNAVAILABLE`, `refused`,
  `unknown`) **dikembalikan**, tidak dilempar; port hanya melempar untuk cacat.
  Pemanggil tidak boleh mengubah penolakan yang dikembalikan menjadi error
  terlempar di transaksinya sendiri tanpa savepoint, dan tidak boleh me-`return`
  4xx dari dalam `withTenant` setelah menulis (itu MENG-COMMIT tulisan tersebut;
  lihat booking §5.2).
- **Identifier itu opak.** `staffRef`, `externalRef`, atau `correlationId` milik
  pihak yang menciptakannya; pihak lain menyimpannya dan tidak pernah
  mem-parse-nya.
- **Waktu.** Setiap instant adalah string RFC 3339 UTC berakhiran `Z`; setiap
  interval setengah-terbuka `[start, end)`. Tidak ada tanggal atau zona waktu
  lokal yang melintasi port.

## 3. Port booking

- **Status:** **dibangun di Issue #941** (`src/modules/_shared/ports/booking-port.ts`,
  adapter `booking/application/booking-port-adapter.ts`). Signature di bawah
  adalah sketsanya; port yang dibangun berbeda dalam empat hal: setiap metode
  menerima transaksi pemanggil lebih dulu dan input membawa `tenantId` (seperti
  port WhatsApp dan ketersediaan staf); `quote` menanyakan satu `resourceId`;
  gabungan penolakan dilengkapi (lihat catatan di akhir bagian ini); dan tidak ada
  override. Sembilan event-nya pindah ke dokumen AsyncAPI live dan registri
  runtime.
- **Modul pemilik:** `booking` (ADR-0131; `src/modules/_shared/ports/booking-port.ts`).
- **Consumer:** adapter commerce downstream (offering ↔ produk, hold → order,
  pembayaran → confirm), route portal atau kiosk di repo yang sama. Booking
  sendiri tidak punya registry consumer dan tidak bergantung pada `commerce`.
- **Aturan transaksi:** adapter berjalan di dalam transaksi tenant pemanggil atau
  membukanya; hanya melakukan kerja database. Penolakan adalah nilai yang
  dikembalikan.
- **Semantik kegagalan:** `ok: false` dengan kode error paket; dilempar hanya
  untuk cacat. Replay `idempotencyKey` yang sama mengembalikan hasil asli dengan
  `replayed: true` dan tidak menulis apa pun.

```ts
type Instant = string; // RFC 3339 UTC, berakhiran "Z"

type BookingRefusal =
  | "SLOT_UNAVAILABLE" // 409: konflik exclusion atau tidak ada unit bebas
  | "OUTSIDE_SCHEDULE" // 409: hanya dicabut oleh override HIGH-RISK
  | "LEAD_TIME_VIOLATION"
  | "HORIZON_EXCEEDED"
  | "PARTY_SIZE_OUT_OF_RANGE"
  | "STAFF_UNAVAILABLE" // 409
  | "RECURRENCE_UNSUPPORTED"
  | "TIMEZONE_INVALID"
  | "HOLD_EXPIRED" // 409
  | "HOLD_LIMIT_EXCEEDED" // 429
  | "INVALID_STATE" // 409
  | "IDEMPOTENCY_CONFLICT" // 409: key sama, request berbeda
  | "PAYMENT_FIELD_NOT_ACCEPTED"; // 400: modul tidak menyimpan state pembayaran

type QuoteInput = {
  tenantId: string;
  offeringId: string;
  startsAt: Instant;
  partySize: number;
  resourceId?: string;
  staffRef?: string; // opak; hanya di-resolve oleh StaffAvailabilityPort
  correlationId: string;
};

interface BookingPort {
  /** Tidak mengikat. Tidak menulis apa pun. Quote bukan janji. */
  quote(input: QuoteInput): Promise<
    | {
        ok: true;
        endsAt: Instant;
        occupiedFrom: Instant;
        occupiedTo: Instant;
        unitsNeeded: number;
      }
    | { ok: false; reason: BookingRefusal }
  >;

  /** Mengklaim slot sebagai hold (atau confirmed bila offering-nya `immediate`). */
  hold(
    input: QuoteInput & {
      customerRef?: string; // referensi profil opak; tidak pernah nama atau kontak
      holdSeconds?: number; // dijepit modul ke [60, max_hold_seconds]
      externalRef?: { type: string; id: string }; // referensi order milik adapter
      idempotencyKey: string; // wajib
    }
  ): Promise<
    | {
        ok: true;
        reservationId: string;
        status: "held" | "confirmed";
        holdExpiresAt: Instant | null;
        replayed: boolean;
      }
    | { ok: false; reason: BookingRefusal }
  >;

  /** held -> confirmed. Memeriksa ulang hold belum kedaluwarsa di bawah row lock. */
  confirm(input: {
    tenantId: string;
    reservationId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;

  /** held | confirmed -> cancelled. Modul mencatat `lateCancellation`; biaya apa pun adalah keputusan adapter. */
  cancel(input: {
    tenantId: string;
    reservationId: string;
    reasonCode: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;

  /** Satu transaksi: lepas alokasi lama, sisipkan pengganti, supersede yang lama. Penolakan me-rollback ke aslinya yang tak tersentuh. */
  reschedule(input: {
    tenantId: string;
    reservationId: string;
    startsAt: Instant;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<BookingOutcome>;
}

type BookingOutcome =
  | { ok: true; reservationId: string; status: string; replayed: boolean }
  | { ok: false; reason: BookingRefusal };
```

Idempotensi, seperti booking §5.2: key wajib pada `hold`, `confirm`, `cancel`,
`reschedule`, `checkIn`, `checkOut` dan `markNoShow`; pengguna yang bertindak menjadi bagian dari hash request; key yang
sama terhadap target berbeda adalah `IDEMPOTENCY_CONFLICT`; mengonfirmasi
reservasi yang sudah `confirmed` mengembalikannya dengan `replayed: true`; dan
exclusion constraint menjadi pengaman kedua lapis itu. Natural key
`(tenant, externalRef.type, externalRef.id)` memungkinkan adapter mencoba ulang
dengan key baru tanpa menggandakan reservasi yang hidup.

**Yang sengaja tidak dibawa port:** harga, deposit, status pembayaran, nama atau
kontak pelanggan, catatan teks bebas. Salah satunya di input adalah
`PAYMENT_FIELD_NOT_ACCEPTED` atau error validasi. Pembayaran milik adapter;
adapterlah yang memutuskan _kapan_ meminta `confirm`.

**Jaga transaksi tetap singkat.** `hold` mengambil advisory lock per tenant
setelah memenangkan unitnya (hitungan batas hold, booking.md §13) dan menahannya
sampai transaksi pemanggil berakhir; kunci idempotensi key-sama ditahan serupa.
Consumer yang membungkus `hold` dalam transaksi panjang (panggilan provider,
render lambat) membuat setiap hold lain tenant itu mengantre di belakangnya.
Lakukan panggilan port, lalu commit; jangan pernah memanggil provider di dalam
transaksi (§2).

Catatan signature: `BookingRefusal` yang dibangun adalah daftar paket yang
dilengkapi dengan apa yang bisa diucapkan klaim dan transisi:
`QUANTITY_EXCEEDS_UNITS`, `BOOKING_MODE_MISMATCH`, `MIN_STAY_VIOLATION`,
`MAX_STAY_EXCEEDED`, `STAY_DATES_INVALID`, `STAY_POOL_INCONSISTENT`,
`CONTENTION_RETRY`, `EXTERNAL_REF_IN_USE`, `RESOURCE_NOT_FOUND`,
`OFFERING_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `RESOURCE_REQUIRED` dan
`VALIDATION_ERROR` (`RECURRENCE_UNSUPPORTED` dan `TIMEZONE_INVALID` tidak bisa
dihasilkan port saat ini dan dikeluarkan; `STAFF_UNAVAILABLE` dipertahankan untuk
irisan staf). Dokumen OpenAPI tidak mengenumerasi kode error. Stay ditanyakan
dengan `stay: { checkInDate, checkOutDate }` sebagai ganti `startsAt`. `hold`
menerima `poolId` sebagai ganti `resourceId`, dan `reschedule` mengembalikan
`reservationId` PENGGANTI.

**Kontrak 1.1.0 (Issue #1108), aditif.** Kapabilitas `booking` diberi versi di
`capability-contract-versions.ts` (`1.0.0` = port di atas; `1.1.0` menambahkan yang
berikut, tidak ada signature yang berubah):

```ts
type Targeted = {
  tenantId: string;
  reservationId: string;
  idempotencyKey: string;
  correlationId: string;
  actorTenantUserId: string;
};

interface BookingPort {
  // ... quote, hold, confirm, cancel, reschedule seperti di atas ...
  checkIn(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>; // confirmed -> checked_in
  checkOut(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>; // checked_in -> completed
  markNoShow(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>; // confirmed -> no_show, setelah mulai + grace
  get(
    tx: Bun.SQL,
    input: { tenantId: string } & (
      { reservationId: string } | { reservationNo: string }
    )
  ): Promise<
    | { ok: true; reservation: BookingReservationRecord }
    | { ok: false; reason: BookingRefusal }
  >;
  getOffering(
    tx: Bun.SQL,
    input: { tenantId: string; offeringId: string }
  ): Promise<
    | { ok: true; offering: BookingOfferingRecord }
    | { ok: false; reason: BookingRefusal }
  >;
  listOfferings(
    tx: Bun.SQL,
    input: {
      tenantId: string;
      cursor?: string | null;
      limit?: number;
      status?: "active" | "inactive";
    }
  ): Promise<
    | {
        ok: true;
        offerings: BookingOfferingRecord[];
        nextCursor: string | null;
      }
    | { ok: false; reason: BookingRefusal }
  >;
  availability(
    tx: Bun.SQL,
    input: BookingAvailabilityInput
  ): Promise<BookingAvailabilityResult>; // tanpa aktor
}
```

`BookingRefusal` bertambah `CHECK_IN_TOO_EARLY` dan `NO_SHOW_TOO_EARLY`. Transisi
idempoten persis seperti `confirm` (key ber-namespace aktor, ADR-0145; replay atau
state yang sudah tercapai adalah `replayed: true`). Pembacaan tidak menulis apa
pun, mengembalikan tidak-ditemukan sebagai nilai, dan **tidak membawa data
pelanggan atau kontak**: `BookingReservationRecord` adalah `{ reservationId,
reservationNo, status, startsAt, endsAt, holdExpiresAt, lineageId, supersededById,
stays[], externalRef }`, dan `availability` hanya mengembalikan slot atau hitungan
stay. Uraian lengkap, termasuk cara halaman booking publik memakai bacaan anonim,
ada di booking.md §10.1.

## 4. Port ketersediaan staf

- **Modul pemilik:** `hr_workforce` (ADR-0132; `src/modules/_shared/ports/staff-availability-port.ts`).
- **Consumer:** `booking` (`consumes` opsional; tanpanya, penugasan hanya dibatasi
  aturan exclusion booking sendiri dan respons berkata
  `staffAvailability: "unchecked"`).
- **Aturan transaksi:** pembacaan di `tx` tenant pemanggil. Tanpa tulis, tanpa
  event, tanpa lock, tanpa I/O.
- **Semantik kegagalan:** fail-closed. Apa pun yang tidak bisa dijamin adapter
  adalah `status: "unknown"` dengan interval kosong; "tidak ditemukan", "tenant
  lain", "soft-deleted", dan "tidak aktif di jendela" sengaja tak terbedakan
  (tanpa existence oracle). Lebih dari 200 staf atau jendela di atas 35 hari
  adalah kesalahan pemanggil (kelas `RangeError`) yang harus dipecah pemanggil.

```ts
type StaffAvailabilityQuery = {
  staffRefs: readonly string[]; // opak (= employment id), 1..200, duplikat dilebur
  fromUtc: string; // inklusif, berakhiran "Z"
  toUtc: string; // eksklusif, setelah fromUtc, rentang <= 35 hari
  officeId?: string;
};

type AvailabilityInterval = { startUtc: string; endUtc: string }; // [start, end)

type StaffAvailability = {
  staffRef: string;
  status: "resolved" | "unknown";
  intervals: readonly AvailabilityInterval[]; // terurut, saling lepas, digabung, dipotong; kosong bila unknown
};

type StaffAvailabilityResult = {
  asOf: string;
  staff: readonly StaffAvailability[];
};

interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: StaffAvailabilityQuery
  ): Promise<StaffAvailabilityResult>;
}
```

Semantik yang wajib dipatuhi consumer: `unknown` itu **tidak dapat dibooking**;
array kosong dengan `resolved` berarti "dijadwalkan untuk tidak ada apa-apa";
jawabannya adalah **bacaan, bukan hold**, sehingga booking memeriksa ulang saat
commit dan memakai `asOf` untuk menilai kebasian; perubahan shift berikutnya
dimunculkan laporan konflik jadwal booking (booking §7.3), tidak pernah dengan
membatalkan diam-diam; nama tampilan berasal dari resource atau `profile_identity`
milik consumer, tidak pernah dari port ini; jangan menyimpulkan alasan
ketidakhadiran dari sebuah celah; jangan mencatat hasil penuh di level `info`.
Hasilnya adalah allow-list tiga field per orang dan secara struktural tidak
memuat data payroll; SQL adapter hanya menyebut jadwal, terms, dan header employment (flag
soft-delete ada di sana; tak satu pun memuat nama atau tarif), dan sebuah test
gagal bila ia pernah menyebut tabel kompensasi, payroll, atau komisi. **Dibangun di
Issue #946** (`src/modules/_shared/ports/staff-availability-port.ts`; adapter
`hr_workforce/application/staff-availability-adapter.ts`).

Hanya ada satu kontrak: yang ini. Paket booking ([`booking.md`](booking.md) §10.3)
mengonsumsinya apa adanya dan tidak menambah persyaratan sendiri.

## 5. Port pengiriman WhatsApp

- **Status:** **live sejak Issue #963** (ADR-0133 fase 1, nonaktif di balik
  `WHATSAPP_ENABLED`). Signature di bawah adalah yang diimplementasikan, dengan
  tiga tambahan pada sketsa provisional: alasan penolakan juga mencakup
  `RECIPIENT_INVALID`, `RECIPIENT_UNRESOLVED`, dan `EXPIRY_REQUIRED`; input
  menerima `createdBy` opsional; dan tipe transaksinya `Bun.TransactionSQL`
  (`WhatsappTenantTx`). Ketujuh event-nya pindah dari dokumen provisional ke
  `asyncapi/awcms-domain-events.asyncapi.yaml` dan `DOMAIN_EVENT_TYPE_REGISTRY`.
- **Modul pemilik:** `whatsapp_delivery` (ADR-0133; `src/modules/_shared/ports/whatsapp-delivery-port.ts`).
- **Consumer:** `booking` (pengingat, konfirmasi), `hr_payroll` (_pemberitahuan_
  shift dan payroll), adapter commerce downstream (OTP, order-paid, kampanye,
  pengiriman dokumen).
- **Aturan transaksi:** `enqueue` dan `cancelByCorrelation` adalah tulis database
  di transaksi **pemanggil** (satu `INSERT` / satu `UPDATE`). Port **tidak punya
  `send`**: provider hanya dipanggil job dispatcher, di luar transaksi apa pun,
  dengan timeout dan circuit breaker.
- **Semantik kegagalan:** penolakan atau suppression **dikembalikan**, sehingga
  booking tidak pernah di-rollback karena pengingat tak bisa diantrekan.
  Pemanggil tidak pernah tahu jawaban provider secara sinkron; ia membaca status
  lewat correlation id, dan status tidak pernah disalin ke tabel pemanggil
  (tidak bisa melenceng).

```ts
type WhatsappPurpose = "transactional" | "security" | "marketing";

type WhatsappRecipient =
  | { kind: "profile"; profileId: string } // di-resolve di dalam modul
  | { kind: "address"; phone: string }; // tamu; dinormalisasi ke E.164 saat masuk

type EnqueueWhatsappInput = {
  tenantId: string;
  templateKey: string; // berawalan modul ("booking.reminder"); terdaftar dengan SATU purpose
  variables: Record<string, string>; // disaring oleh allow-list template
  recipient: WhatsappRecipient;
  idempotencyKey: string; // wajib
  correlationId?: string;
  notBefore?: Date;
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
  enqueue(
    tx: TenantTx,
    input: EnqueueWhatsappInput
  ): Promise<EnqueueWhatsappResult>;
  getStatusByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<WhatsappStatus[]>;
  /** Membatalkan pesan yang masih antre; no-op (mengembalikan 0) setelah terkirim. */
  cancelByCorrelation(
    tx: TenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<number>;
}
```

Idempotency key unik per `(tenant_id, idempotency_key)`; replay mengembalikan
`duplicate` dengan message id yang sudah ada. Signature bersifat **provisional**
seperti kata ADR-0133 §8; ADR implementasi menetapkannya. Nomor telepon, isi
pesan, atau variabel template tidak pernah muncul di event, baris audit, atau log;
pemanggil hanya tahu id dan penerima yang dimasking.

### 5.1 Port pengiriman Telegram (live, #965)

- **Status:** **live sejak Issue #965** (ADR-0140, tidak aktif di balik `TELEGRAM_ENABLED`). Berbeda dengan §5, ia membawa **hanya notifikasi operasional dan staf**, kepada staf yang mengikat chat pribadinya sendiri; ia tidak pernah menjadi fallback WhatsApp atau e-mail dan tidak ada kanal lain yang fallback ke sini (ADR-0139).
- **Modul pemilik:** `telegram_delivery` (`src/modules/_shared/ports/telegram-delivery-port.ts`).
- **Konsumen:** `booking` (pengingat staf), `workflow_approval` (ping persetujuan tertunda), dan notifikasi operasional platform sendiri. Belum ada yang tersambung; masing-masing mendaftarkan template `staff_ops` berawalan modulnya (`registerTelegramTemplate`) di issue-nya sendiri. Modul pemilik payroll tidak dapat mendaftarkannya (`bun run telegram:templates:check`).
- **Aturan transaksi:** seperti §5. `enqueue` dan `cancelByCorrelation` adalah penulisan dalam transaksi tenant **pemanggil**; tidak ada `send` dan tidak ada body teks bebas. Tenant dibaca dari konteks RLS transaksi itu sendiri, sehingga port tidak punya parameter `tenantId`.
- **Semantik kegagalan:** penolakan **dikembalikan**: `DISABLED` (deployment, tenant, atau modul mati), `TEMPLATE_UNKNOWN`, `NO_BINDING`, `RATE_LIMITED`, `EXPIRY_REQUIRED`. **`NO_BINDING` tidak memicu apa pun lagi**: apa yang dilakukan konsumen terhadap orang tanpa chat tertaut adalah keputusan eksplisitnya sendiri, di modulnya sendiri.

```ts
type EnqueueTelegramInput = {
  templateKey: string; // berawalan modul; terdaftar dengan SATU purpose "staff_ops"
  recipientPrincipalId: string; // tenant user (awcms_tenant_users.id), bukan id chat
  variables: Record<string, string>; // bertipe menurut kind (reference | count | token | link); selebihnya dibuang
  idempotencyKey: string; // wajib, unik per tenant
  expiresAt: Date; // wajib, di masa depan dan paling lama 7 hari
  correlationId?: string;
};

type EnqueueTelegramResult =
  | { status: "queued"; messageId: string }
  | { status: "duplicate"; messageId: string }
  | {
      status: "refused";
      reason:
        | "DISABLED"
        | "TEMPLATE_UNKNOWN"
        | "NO_BINDING"
        | "RATE_LIMITED"
        | "EXPIRY_REQUIRED";
    };
```

## 6. Idempotensi per consumer ber-efek-samping — diterbitkan sekali bukan berarti ditangani sekali

Pengiriman bersifat **at-least-once**. Handler yang sudah berjalan lalu crash
sebelum baris delivery-nya commit sah dicoba lagi, sehingga setiap consumer di
bawah harus aman dijalankan dua kali untuk event yang sama. ADR-0134 membuat
default-nya struktural: consumer yang dideklarasikan di descriptor modulnya dengan
`idempotency: "runtime_effect_once"` memiliki `handle`-nya (yaitu _efek_)
dibungkus registry dalam `applyConsumerEffectOnce`, berkunci `(tenant, nama
consumer, event id)`; efek yang gagal me-rollback seluruh transaksi delivery,
termasuk marker. Consumer yang tak bisa memakai marker itu mendeklarasikan
`self_managed` dengan `idempotencyRationale` yang ditinjau. **Tidak ada consumer
yang memanggil `applyConsumerEffectOnce` sendiri.** Cara adapter downstream
berlangganan: ia mendeklarasikan consumer di descriptor modulnya **sendiri**
(`domainEventConsumers`), menyebut tipe dan versi event; tidak ada berkas upstream
yang diedit dan tidak ada modul upstream yang mengimpornya.

Baris di bawah adalah consumer yang tersirat dari paket desain. Mereka
_mengilustrasikan strateginya_: masing-masing dideklarasikan modul pemiliknya
(atau adapter downstream) saat modul itu dibangun, dan tidak ada yang ada hari ini.

| Consumer (dideklarasikan oleh)                                      | Event                                                          | Efek samping                                                            | Strategi                                                                                                                                                                                                | Garis pertahanan kedua                                                                                                                                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pengingat booking (`booking`)                                       | `…reservation.confirmed`                                       | `WhatsappDeliveryPort.enqueue` dengan `notBefore`                       | `runtime_effect_once`                                                                                                                                                                                   | `idempotencyKey = "<consumer>:<eventId envelope>"`; port menjawab `duplicate` saat replay                                                                                                     |
| Penarikan pengingat booking (`booking`)                             | `…reservation.cancelled`, `…reservation.rescheduled`           | `cancelByCorrelation(reservationId)`                                    | `runtime_effect_once`                                                                                                                                                                                   | Idempoten secara alami: panggilan kedua tak menemukan antrean dan mengembalikan 0                                                                                                             |
| Pembatalan order saat kedaluwarsa (adapter commerce)                | `…reservation.expired`, `…reservation.cancelled`               | membatalkan order pending yang disebut `externalRef`                    | `runtime_effect_once`                                                                                                                                                                                   | Handler memeriksa state order lebih dulu; membatalkan order yang sudah batal adalah no-op                                                                                                     |
| Confirm saat dibayar (adapter commerce)                             | tidak ada (mengonsumsi sinyal pembayaran, bukan event booking) | `BookingPort.confirm`                                                   | `self_managed`                                                                                                                                                                                          | `confirm` idempoten pada `idempotencyKey`-nya sendiri (diturunkan dari id pembayaran) dan pada state check                                                                                    |
| Koordinasi refund (adapter commerce)                                | `…reservation.cancelled`                                       | membuat permintaan refund                                               | `self_managed`; rationale: natural key `(tenant, externalRef, "refund")` unik di tabel adapter                                                                                                          | Unique constraint pada natural key                                                                                                                                                            |
| Invalidasi ketersediaan (`booking`)                                 | `awcms.hr.shift.assigned`                                      | menghitung ulang read model konflik jadwal                              | `runtime_effect_once`                                                                                                                                                                                   | Penghitungan ulang adalah upsert berkunci `assignmentId`, sehingga dua kali jalan konvergen                                                                                                   |
| Posting payroll (adapter finance)                                   | `awcms.hr.payroll.finalized`, `awcms.hr.payroll.reversed`      | memposting (atau membalik) jurnal dari pembacaan terotorisasi total run | `self_managed`; rationale: posting jurnal punya `Idempotency-Key` sendiri yang diturunkan dari `runId`, dan entri yang sudah posted immutable                                                           | Lapis idempotensi ledger; event **tidak membawa nominal**, sehingga total berasal dari pembacaan baru                                                                                         |
| Serah-terima pembayaran komisi (adapter finance)                    | `awcms.hr.commission.approved`                                 | meminta payout dari pembacaan terotorisasi                              | `self_managed`; rationale: natural key `accrualId`                                                                                                                                                      | Unique constraint pada `accrualId` di adapter                                                                                                                                                 |
| Pemberitahuan shift (`hr_workforce`)                                | `awcms.hr.shift.assigned`                                      | `WhatsappDeliveryPort.enqueue`                                          | `runtime_effect_once`                                                                                                                                                                                   | `idempotencyKey = "<consumer>:<eventId envelope>"`; pemeriksaan consent dan suppression adalah milik port                                                                                     |
| Dispatcher WhatsApp (`whatsapp_delivery`, **bukan** consumer event) | n/a (membaca baris outbox-nya sendiri)                         | panggilan provider                                                      | **Catatan delivery, bukan marker efek.** Baris outbox unik per `(tenant_id, idempotency_key)`; claim adalah lease `FOR UPDATE SKIP LOCKED`; tiap percobaan adalah satu baris; id pesan provider dicatat | At-least-once ke provider diakui (ADR-0133 §5); crash di antara provider menerima dan baris difinalkan bisa mengirim ulang, yang id provider tercatat memungkinkan rekonsiliasi mendeteksinya |

Tiga hal yang tak muat di tabel:

1. **Dua lapis idempotensi itu hal yang berbeda.** Marker registry membuat
   _handler_ berjalan sekali per `(consumer, event)`. Key tingkat port
   (`idempotencyKey` milik `enqueue`, `confirm`) membuat _efeknya_ aman bahkan
   bila marker entah bagaimana tidak ada (consumer `self_managed`, replay setelah
   purge ledger efek). Keduanya murah; tidak ada yang menggantikan yang lain.
2. **WhatsApp bukan consumer event dan tidak boleh menjadi.** Handler-nya akan
   berjalan di dalam transaksi dispatch dan memanggil provider, yang dilarang
   ADR-0006 (ADR-0133 §3). Booking dan hr menjangkaunya hanya lewat port, di
   transaksi sendiri atau di `handle` consumer, di mana `enqueue` adalah satu
   `INSERT`.
3. **Penolakan yang dikembalikan di dalam consumer adalah penanganan yang
   berhasil.** Hasil `refused` atau `suppressed` dicatat port; consumer tidak boleh
   melempar (itu akan mengulang keputusan yang tidak akan berubah dan akhirnya
   dead-letter).

## 7. Dari provisional ke live

Dokumen provisional adalah `asyncapi/provisional/…provisional.asyncapi.yaml`.
Tidak ada yang membacanya kecuali `bun run asyncapi:provisional:check` (di rantai
`check`): generator referensi API, test paritas registry, dan manifest family
conformance hanya membaca `asyncapi/awcms-domain-events.asyncapi.yaml`, sehingga
event provisional **tak terlihat oleh kontrak live** dan kesalahan di dalamnya
tidak bisa menerbitkan, mendaftarkan, atau merusak apa pun.

**Aturannya: sebuah event hidup di tepat satu dari dua tempat.** Entah berkas
provisional, atau pasangan live (`asyncapi/awcms-domain-events.asyncapi.yaml`
ditambah `DOMAIN_EVENT_TYPE_REGISTRY` ditambah `events.publishes` modul
produsen). Check gagal bila sebuah nama ada di keduanya, sehingga perpindahan
tidak bisa setengah jadi.

PR implementasi tiap modul, dalam satu perubahan:

1. Menambahkan event ke `DOMAIN_EVENT_TYPE_REGISTRY` dan ke `events.publishes` di
   `module.ts` produsen.
2. Menambahkan channel ke berkas AsyncAPI live (satu channel per event, message
   `DomainEvent` bersama, produsen disebut di deskripsi) dan menaikkan
   `info.version`-nya sesuai kebijakan versi kontrak.
3. **Menghapus event dari berkas provisional** (channel dan message). Check
   merah sampai itu dilakukan.
4. Menyegarkan referensi API ter-generate (`bun run api:docs:generate`) dan
   menambah changeset.
5. Menambahkan test produsen yang dituntut test paritas live (registry ↔ channel
   ↔ `events.publishes`), dan bila payload berubah selama implementasi, skema
   payload ditulis dengan gaya berkas live sendiri pada saat itu.

Bila event terakhir sebuah keluarga sudah pindah, berkas provisional dihapus;
bila yang terakhir dari semuanya sudah pindah, check, test-nya, dan entri
`package.json` ikut dihapus.

Penamaan: event adalah `awcms.<area>.<entity>.<verb>`. Paket dan ADR-0133 menulis
singkatan tanpa awalan (`booking.reservation.*`, `hr.*`, `whatsapp.message.*`);
di wire mereka membawa `awcms.`. Check menegakkan tepat empat segmen huruf kecil.

Aturan payload yang ditegakkan check: setiap skema payload tertutup
(`additionalProperties: false`); tidak ada nama properti yang mengandung kata
untuk nominal, state pembayaran, data pribadi, atau teks bebas (`amount`,
`salary`, `payment`, `phone`, `email`, `name`, `note`, `reason`, `body`, …). Event
`hr` **tidak membawa nominal** (tenant dengan satu karyawan akan membocorkan gaji
lewat "agregat"); event `booking` **tidak membawa state pembayaran**; event
`whatsapp` hanya membawa id dan penerima yang dimasking. Consumer
mende-duplikasi pada `eventId` envelope.

Versi: setiap message mengunci `eventVersion` ke `"1.0"`. Perubahan payload yang
breaking setelah live adalah `eventVersion` baru yang didaftarkan di samping yang
lama, bukan suntingan.

## 8. Butir terbuka

- Nama port WhatsApp dan tipe field payload hr yang
  persis (misalnya enumerasi `kind`, `source`, `operation`) ditetapkan tiap PR
  implementasi; skema provisional membiarkannya sebagai string di mana paket tidak
  mendaftar himpunan tertutup.
- Pemetaan modul produsen `awcms.hr.*` (`hr_workforce` / `hr_compensation` /
  `hr_payroll`) dipastikan saat channel pertama pindah (ADR-0132).
- Apakah consumer mana pun di tabel di atas dikirim di repo ini atau hanya di
  template downstream adalah keputusan admission tiap modul, bukan dokumen ini.
