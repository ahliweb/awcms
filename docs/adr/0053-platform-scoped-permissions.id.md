🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0053-platform-scoped-permissions.md)

<!-- i18n-source-hash: sha256:2301de1014defee824b46f474b2d69e2bce6ee5ab321a272ddba5a11a2303ca8 -->

# ADR-0053 — Permission ber-scope platform, dipegang owner tenant default

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Pengambil keputusan:** @ahliweb
- **Menyempurnakan:** [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) — mengembalikan permukaan HTTP aktivasi/rollback dataset wilayah, kini di balik gerbang yang ADR itu tetapkan sebagai syaratnya. Job operatornya **tetap ada**.
- **Memenuhi:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) §Keputusan butir 1–3 (gerbang platform-scoped untuk aksi lintas-tenant) — yang sampai sekarang normatif tanpa primitif
- **Terkait:** [ADR-0046](0046-idn-admin-regions-module-admission.md) (admisi `idn_admin_regions`), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial mesin baca-saja), [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) §3/§4 (fitur fondasi dirintis di sini + wajib dicatat sebagai divergence)

## Konteks

ADR-0051 menuliskan aturan ini sebagai norma:

> Aksi yang efeknya melintasi batas tenant **wajib punya gerbang platform-scoped**, bukan sekadar RBAC tenant. Aksi lintas-tenant **tidak boleh** masuk katalog yang di-seed ke role tenant.

Aturannya benar dan sudah berlaku — tetapi **primitifnya tidak pernah ada**. Karena itu ADR-0052 tidak bisa menggerbangi aktivasi/rollback dataset wilayah; ia hanya bisa **menghapusnya**, dan mencatat bahwa layar operator boleh kembali "bila kelak sungguh dibutuhkan… ADR ini hanya menolak mengapalkan permukaannya sebelum gerbangnya ada".

Layar itu sekarang dibutuhkan, dan ini gerbangnya.

### Cacat yang sesungguhnya tidak pernah diperbaiki

`sql/084` menghapus dua baris permission. Yang **melahirkan** cacatnya masih utuh, di `bootstrapPlatformTenant`:

```ts
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT ${tenantId}, ${roleId}, id FROM awcms_permissions
```

Setiap tenant yang dibuat menerima **seluruh** katalog. Menghapus dua baris menutup satu instansnya; **kelasnya kembali pada aksi lintas-tenant berikutnya yang ditambahkan siapa pun**. Selama statement itu tidak bisa mengecualikan satu populasi, satu-satunya perlindungan yang tersisa adalah tidak seorang pun pernah mendeklarasikan permission semacam itu lagi — dan itu bukan perlindungan.

## Keputusan

### 1. `awcms_permissions.scope` — `tenant` | `platform`

`sql/085` menambah kolom, `DEFAULT 'tenant'` (yang persis arti setiap permission yang sudah ada, sehingga backfill-nya nol baris ditulis tangan). `ModulePermissionDescriptor.scope` mendeklarasikannya di kode; `MODULE_CONTRACT_VERSION` naik ke **2.5.0** (MINOR — aditif, menghilangkannya berarti `tenant`).

Grant borongan kini `WHERE scope = 'tenant'`. Konsekuensinya yang jadi tujuan: **permission platform berikutnya aman sejak ia dideklarasikan** — tanpa seorang pun perlu ingat.

### 2. Tenant platform = tenant default, di-resolve env-first

`PLATFORM_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` → `awcms_setup_state.tenant_id`.

Default-nya **sengaja rantai yang sama** dengan resolver publik: di deployment satu-tenant keduanya tenant yang sama, dan jawaban kedua hanya akan jadi hal kedua yang harus dijaga tetap sinkron. Wewenangnya jatuh pada **role `owner` tenant itu** — tidak ada peran baru, tidak ada flag baru.

Satu asimetri terhadap resolver publik, disengaja: `PLATFORM_TENANT_ID` yang **diisi tapi tak bisa di-resolve** (bukan UUID, tenant tidak ada, tenant nonaktif) menghasilkan `null` dan **menolak semua aksi platform** — ia tidak pernah jatuh ke langkah berikutnya. Untuk RENDERING, turun ke kandidat berikutnya itu anggun; untuk WEWENANG, itu menyerahkan hak ke tenant yang tidak disebut siapa pun.

### 3. Gerbang di chokepoint, bukan di layar

`authorizeInTransaction` menolak permission ber-scope platform kecuali tenant yang bertindak **adalah** tenant platform — diputus **sebelum** izin dilihat, sekelas dengan penolakan baca-saja kredensial mesin (ADR-0049 §3). Jadi baris grant yang nyasar (backup ter-restore, `INSERT` tangan, jalur provisioning masa depan yang lupa filternya) menjadi **inert**, bukan cukup.

Pemicunya dibaca dari **deklarasi kode**, bukan dari kolom DB. Kalau keduanya dari DB, satu `UPDATE` yang membalik `scope` ke `'tenant'` akan mencabut gerbangnya sekaligus filternya — aksi lintas-tenant tanpa penjagaan apa pun, dengan semua cek tetap hijau. Kolom DB menentukan **siapa di-grant**; kode menentukan **apakah gerbangnya ditanya**. `tests/platform-scoped-permissions.test.ts` mengikat keduanya dua arah.

### 4. Mode ketenanan diturunkan, tidak pernah dikonfigurasi

`single` selama tenant platform satu-satunya tenant aktif; `multi` sejak ada yang kedua. Tidak ada toggle: flag tersimpan harus dibalik oleh siapa pun yang mem-provision tenant kedua, dan gagalnya lupa berarti deployment terus berperilaku seolah satu tenant memiliki segalanya — persis asumsi yang harus berhenti berlaku.

**Mode tidak pernah melonggarkan gerbang.** Penegakan identik di kedua mode; `single` hanya mengubah apa yang layar jelaskan. Selain itu, postur keamanan akan bergantung pada hasil `COUNT(*)`.

### 5. Permukaan yang kembali

`POST /api/v1/idn-regions/datasets/{id}/activate` dan `/rollback` dipulihkan di balik permission platform, plus layar `/admin/idn-regions`.

Keberatan audit ADR-0052 **terjawab, bukan diabaikan**: `recordAuditEvent` tenant-scoped, yang dulu berarti barisnya mendarat di log tenant mana pun yang kebetulan menekan tombol. Kini ia hanya bisa mendarat di log **tenant platform** — tempat aksi platform memang seharusnya tercatat.

Job operatornya (`bun run idn-regions:activate` / `:rollback`) **dipertahankan**: CI, shell pemulihan, dan deployment yang tenant platform-nya tak bisa login semuanya butuh jalur non-HTTP.

## Konsekuensi

- **Positif:**
  - Kelas cacatnya tertutup, bukan instansnya. Grant borongan tidak bisa lagi membocorkan wewenang lintas-tenant, hari ini maupun untuk permission platform berikutnya.
  - Dua mekanisme independen (filter grant + gerbang chokepoint), sehingga kegagalan salah satunya tidak cukup.
  - Prasyarat SaaS yang sesungguhnya. Jalur provisioning tenant — yang belum ada — kini punya tempat yang benar untuk berdiri: ia mewarisi filter `scope`, bukan mengulang cacatnya.
- **Negatif / trade-off yang diterima:**
  - **Selama `PLATFORM_TENANT_ID` kosong, `PUBLIC_DEFAULT_TENANT_ID` adalah kontrol keamanan.** Mengarahkan ulang situs mana yang tampil di host tak-tercocokkan ikut mengarahkan wewenang platform. Ini keputusan sadar (satu knob selama keduanya memang tenant yang sama), dibuat aman untuk ditinggalkan lewat variabel terpisah yang tinggal diisi — dan **dibuat terlihat**: `security:readiness` melaporkan tenant mana yang memegang wewenang itu.
  - Satu query tambahan per request — **hanya** untuk permission ber-scope platform. Request biasa tidak menyentuhnya sama sekali.
  - `awcms_permissions` bertambah kolom: setiap seed permission baru sekarang punya pertanyaan yang harus dijawab. Itu memang maksudnya.
- **Netral:**
  - Nol perubahan perilaku untuk deployment satu-tenant: tenant bootstrap adalah tenant platform, dan owner-nya menerima kedua permission itu lewat `sql/085`.

## Alternatif yang dipertimbangkan

- **Biarkan job-only (status quo ADR-0052)** — ditolak karena alasan yang ADR-0052 sendiri sebut sementara: operasi platform yang sah tidak boleh menuntut akses shell selamanya, dan tidak adanya gerbang adalah kekurangan yang bisa diperbaiki, bukan hukum alam.
- **Gerbangi dengan kredensial mesin** — ditolak lagi, dengan alasan ADR-0052: kredensial mesin **baca-saja** (ADR-0049 §3), jadi melebarkannya membuat token build yang bocor bisa mengganti dataset global. Lebih buruk dari cacat yang diperbaiki.
- **Role/flag "superadmin" global** — ditolak: memperkenalkan subjek di luar model tenant, sehingga RLS, decision log, dan audit semuanya butuh kasus khusus. Tenant platform sebagai tenant biasa membuat seluruh rantai yang ada tetap berlaku apa adanya.
- **Anchor DB murni (`awcms_setup_state` saja, tanpa env)** — diusulkan dan **ditolak oleh pengambil keputusan** demi satu definisi "tenant default" yang dipakai bersama `awcms-astro`. Risikonya dinyatakan di §Konsekuensi dan dibuat bisa dipisah tanpa migrasi lewat `PLATFORM_TENANT_ID`.
