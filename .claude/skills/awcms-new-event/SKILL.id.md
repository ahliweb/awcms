---
name: awcms-new-event
description: Tambah atau ubah domain event AWCMS. Gunakan saat mem-publish event baru (mis. sales.transaction.posted), mengubah payload event, atau menambah subscriber. Menegakkan envelope event standar dan update AsyncAPI sesuai doc 05.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:ca21e943b95ffb5c9641e83187f79ceb6ccfb39eb0ff6eb54410f21c9f727fe0 -->

# AWCMS — New / Changed Domain Event

Ikuti `docs/awcms/05_openapi_asyncapi_detail.md`.

## Dua bentuk BERBEDA — jangan tertukar

Ada **dua** shape berbeda di sistem event ini, dipakai di layer berbeda.
Keduanya WAJIB didokumentasikan/diikuti, tapi jangan campur satu sama lain.

### 1. Wire envelope (kontrak AsyncAPI, yang keluar ke consumer eksternal)

Satu-satunya sumber kebenaran: `asyncapi/awcms-domain-events.asyncapi.yaml`'s
`components.schemas.DomainEventEnvelope` — `additionalProperties: false`,
jadi field di luar daftar ini **ditolak**, bukan diabaikan:

```ts
type DomainEventEnvelope<TPayload> = {
  event_id: string; // uuid
  event_type: string; // pattern "^[a-z0-9]+(\.[a-z0-9_]+)+$", mis. "awcms.blog-content.post.published"
  occurred_at: string; // ISO date-time
  producer: { service: "awcms"; module: string }; // module = ModuleDescriptor.key penerbit
  tenant_id?: string | null;
  correlation_id?: string | null;
  payload: TPayload; // additionalProperties: true
};
```

Tidak ada `event_version`/`node_id`/`aggregate_type`/`aggregate_id`/`actor`/
`causation_id`/`metadata` di envelope ini — kalau butuh versi payload,
encode di `event_type`/dalam `payload` sendiri, bukan field envelope
terpisah (skema sengaja minimal & tertutup).

### 2. DB-level append input (internal, `domain-event-runtime`'s outbox)

`AppendDomainEventInput` (`domain-event-runtime/application/append-domain-event.ts:18-38`)
adalah shape yang BENAR-BENAR dipanggil kode modul lain untuk menulis baris
outbox — **beda dari envelope wire di atas**, flat, dan TIDAK punya `eventId`
(dibuat DB lewat `RETURNING id`, bukan digenerate caller):

```ts
type AppendDomainEventInput = {
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number;
  orderKey?: string; // default deriveOrderKey(aggregateType, aggregateId)
  correlationId?: string | null;
  causationId?: string | null;
  producerModule: string; // ModuleDescriptor.key penerbit, selalu eksplisit
  schemaRef?: string | null; // pointer dokumentasi ke channel AsyncAPI, tidak divalidasi di sini
  actorTenantUserId?: string | null;
  actorProfileId?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: Date; // default now()
};
```

`appendDomainEvent` menyimpan baris ini ke `awcms_domain_events` +
delivery rows dalam transaksi yang sama dengan perubahan state sumbernya;
proses dispatch terpisah yang membaca outbox itulah yang merakit shape #1
(wire envelope) untuk dikirim ke consumer — jangan asumsikan kedua shape
identik saat membaca/menulis kode di kedua layer.

## Aturan

1. Nama event `namespace.aggregate.action` (lowercase, titik).
2. Bump `eventVersion`/`schemaVersion` bila payload berubah tidak-kompatibel.
3. **Payload tidak boleh** membawa raw PII/tax identity (mask dulu — `awcms-sensitive-data`).
4. Publish **setelah** commit transaction (atau lewat outbox), bukan menggantikan audit.
5. Node hybrid: event masuk `awcms_sync_outbox` untuk sync (`awcms-sync-hmac`).
6. **Update AsyncAPI** (`asyncapi/`) untuk event & payload baru; jalankan `api:spec:check`.

## Menambah subscriber (consumer)

Consumer dideklarasikan di `module.ts` modul **pemilik**
(`domainEventConsumers`, ADR-0134), tidak pernah ditambahkan ke
`domain-event-runtime/infrastructure/consumer-registry.ts` (yang membangun
registry dan tidak memegang consumer). Resep lengkap dan aturan:
`src/modules/domain-event-runtime/README.id.md` §"Mendeklarasikan konsumen".
Singkatnya:

- cantumkan `domain_event_runtime` di `dependencies` modul;
- `name` adalah `<modul>.<peran>`, unik global, dan **tak pernah diganti** (ia
  menjadi kunci baris delivery dan ledger efek);
- `eventTypes` harus ada di `events.publishes` salah satu modul (dan tipe event
  di `DOMAIN_EVENT_TYPE_REGISTRY` + AsyncAPI) atau `bun run domain-events:consumers:check`
  gagal;
- `handle` adalah **efek samping**; registry membungkusnya dengan
  `applyConsumerEffectOnce` (diterbitkan sekali bukan berarti ditangani sekali).
  Jangan memanggil helper itu sendiri. Consumer dengan idempotensi sendiri
  (upsert kunci alami, inbox sendiri) menyatakan `idempotency: "self_managed"`
  beserta `idempotencyRationale`.

## Event inti (contoh channel nyata — bukan daftar lengkap)

`asyncapi/awcms-domain-events.asyncapi.yaml` adalah satu-satunya
sumber kebenaran — jumlah channel bertambah tiap modul baru, JANGAN
hardcode angkanya di skill ini (drift setiap audit); jalankan
`grep -c "^  awcms\." asyncapi/awcms-domain-events.asyncapi.yaml`
untuk hitungan hidup, dan `grep -n "^  awcms\." ...` untuk daftar
lengkap. Contoh representatif lintas modul yang BENAR-BENAR ada di sana:

- `awcms.blog-content.post.published` (`blog_content`)
- `awcms.social-publishing.job.published` (`social_publishing`)
- `awcms.email.message.sent` (`email`)
- `awcms.sync.push.requested` (baseline envelope `sync-storage`)
- `awcms.database.pool.saturated` (backpressure/pooling, doc 16)

Jangan karang nama channel domain retail/POS (mis. `sales.*`/
`warehouse.*`/`tax.*`/`crm.*`) sebagai contoh — modul-modul itu tidak ada
di base repo ini, dipindahkan ke aplikasi turunan contoh (mis. AWPOS);
lihat `docs/awcms/06_github_issues_detail.md` §"Riwayat perubahan
backlog" dan skill `awcms-legacy-migration`. Event baru mengikuti
pola `namespace.aggregate.action` di atas, dengan `namespace` = `module_key`
modul nyata yang menerbitkannya.

## Verifikasi

```bash
bun run api:spec:check
```

Register `publishes`/`subscribes` di `module.ts` modul terkait dan perbarui tabel event di doc 05 bila menambah event inti.
