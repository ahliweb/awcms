# ADR-0084 — Sebuah entitlement MENOLAK, ia tidak pernah memberi

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 5 PR 5.1. Migrasi `sql/109` (skema + katalog
  dasar). Gerbang baru `access:entitlement:deny-only:check` (rantai 39 → 40).
- **Membangun di atas:**
  [ADR-0053](0053-platform-scoped-permissions.md) (gerbang struktural yang tidak
  boleh bisa dilangkahi sebuah baris grant),
  [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (kelas mutasi yang
  membuat gerbang hijau sambil jawabannya salah),
  [ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md) (kontrol
  yang bisa mematikan obatnya sendiri bukan kontrol), dan
  [ADR-0076](0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)
  (kewajiban retensi untuk setiap tabel baru).

## Keputusan

Lima tabel dan satu cabang penolakan di `authorizeInTransaction`:
`403 ENTITLEMENT_REQUIRED`, `matchedPolicy: "entitlement_required"`, diputuskan
**setelah** `module_disabled` dan **di atas** `fetchGrantedPermissionKeys`.

Lapisan entitlement hanya bisa mengatakan TIDAK. Tidak ada bentuk nilai yang
bisa dikembalikannya yang berarti "ya": setiap fungsi keputusan yang diekspor
`domain/entitlement.ts` bertipe `EntitlementDenial | null`, dan properti itu
**diperiksa mesin** oleh gerbang baru, bukan diserahkan pada review.

Gelombang ini **mendarat inert**: nol modul mendeklarasikan
`requiresEntitlement`, jadi cabangnya tak terjangkau dan pernyataan SQL yang
dikeluarkan chokepoint adalah **pernyataan yang SAMA** seperti sebelum gelombang
ini — bukan yang setara. `tests/entitlement-guard-chain.test.ts` membuktikannya
dengan membandingkan teks pernyataannya, bukan dengan mengklaimnya.

## Kenapa MENOLAK dan tidak pernah MEMBERI

`docs/PROJECT_STATE.md` §4 sudah memuat penolakan yang mengunci ini:
`subject.entitlements` **ditolak** sebagai atribut ABAC. ADR ini adalah bentuk
dari penolakan itu.

Kalau sebuah tenant bisa menulis `allow when subject.entitlements contains X`,
maka penurunan plan akan menolak lewat **jalur kode lain dengan sentinel lain** —
dua jawaban untuk satu pertanyaan, dan decision log tidak bisa mengatakan
mekanisme mana yang bicara. Lebih buruk: semantik _allow-as-constraint_ berarti
kebijakan yang tampak melonggarkan sebenarnya mengetatkan, dan sebaliknya.

Mutasi yang merusak properti ini satu baris dan terbaca seperti kerapian:

```diff
-  if (facts.held) return null;
+  if (facts.held) return { allowed: true, ... };
```

Nol test perilaku memerah. Kegagalan yang keras datang belakangan, saat sebuah
call site mulai membaca `.allowed` — dan entitlement menjadi **jalur grant
kedua**, tempat tenant diotorisasi oleh tagihan alih-alih oleh peran. Ini persis
kelas yang ADR-0063 catat: mutasi yang memindahkan cek RBAC ke atas blok ABAC
membiarkan seluruh test hijau.

Karena itu gerbangnya lahir dengan **probe SINTETIS** — empat sumber yang cacat
dengan sengaja yang wajib ditolak detektornya. Gelombang 1 mencatat kenapa:
sebuah cek yang hanya dibuktikan oleh "ia tidak menemukan apa-apa" tidak
dibuktikan oleh apa pun, dan alarm ledger mati justru saat ledgernya mencapai
nol.

## Urutan: setelah `module_disabled`, di atas pembacaan grant

**Di atas `fetchGrantedPermissionKeys`** karena itulah yang membedakan gerbang
struktural dari gerbang berbentuk-permission (aturan lintas-gelombang 1). Sebuah
plan wall yang bisa dilangkahi baris grant bukan plan wall — dan kegagalannya
tak terlihat sampai baris grant pertama yang seharusnya tidak ada muncul (backup
yang di-restore, satu INSERT tangan, jalur provisioning yang kehilangan
`WHERE`).

**Setelah `module_disabled`** karena itu keputusan PRODUK, bukan keamanan. Tenant
yang mematikan modulnya SENDIRI berhak diberi tahu itu, bukan ditawari upgrade:
menyuruh orang membayar padahal perbaikannya adalah tombol yang sudah ia pegang
adalah tiket dukungan yang diproduksi oleh pesan kesalahan.

`tests/guard-structural-gate-order.test.ts` menegakkan kelima gerbang pada level
SOURCE, karena — aturan lintas-gelombang 4 — klaim "X berjalan sebelum Y" bisa
dipuaskan oleh susunan yang benar DAN oleh susunan yang termutasi, jadi test
perilaku tidak bisa membedakannya.

## Tiga pengecualian keras, dan kenapa masing-masing ada

1. **Tenant platform.** Langganan yang lewat tempo tidak boleh mengunci operator
   keluar dari control plane tempat langganan itu diperbaiki. Argumen yang sama
   persis dipakai ADR-0073 untuk suspensi.

   Sumbu ini sengaja **TIDAK fail-closed**: tenant platform yang tak bisa
   di-resolve menghasilkan `false`, yang berarti operator digerbangi seperti
   siapa pun — bukan semua orang diperlakukan sebagai operator.

2. **Modul `isCore`.** `module_management` adalah modul yang menyalakan kembali
   segalanya. Plan wall di depannya adalah kontrol yang mematikan obatnya
   sendiri. Deklarasi pada modul core **tidak dihormati**
   (`requiredEntitlementForModule` mengembalikan null) — dan karena deklarasi
   yang diabaikan runtime lebih buruk daripada tidak ada deklarasi, ia juga
   memerahkan `modules:compose:check` alih-alih diam.

3. **Deskriptor tanpa `requiresEntitlement`.** Inilah yang membuat gelombang ini
   inert, dan ia bukan flag: ketiadaan berarti "tanpa prasyarat komersial", yang
   persis makna setiap deskriptor hari ini.

## Katalog itu GLOBAL dan tidak bisa ditulis saat request

Tiga tabel katalog terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` dengan
ketiga verba tulis dilarang. Preseden bentuknya `awcms_permissions`, tetapi
alasannya lebih keras di sini.

`awcms_permissions` read-only karena menciptakan permission saat request itu
absurd. Ketiganya read-only karena menulisnya adalah **eskalasi**: tidak ada
`tenant_id` di sini untuk dipolisikan sebuah policy, jadi jalur request yang
memegang INSERT pada `awcms_plan_entitlements` bisa memberi dirinya fitur apa
pun dan **tidak satu pun policy RLS akan keberatan**.

Biayanya dinyatakan, bukan disembunyikan: membuat atau mengubah harga plan adalah
**MIGRASI**, bukan layar admin. Itu bentuk yang benar untuk repo ini — sebuah
template yang katalog plannya adalah artefak deployment — dan itulah alasan
`/admin/subscriptions` (PR 5.4) bisa menugaskan tenant ke sebuah plan tanpa
pernah bisa mengubah isi plan itu.

## Dua tabel tenant, bukan satu

`awcms_tenant_subscriptions` menjawab "pelanggan ini membayar apa"; ia bergerak
pada jam tagihan dan mesin transisi PR 5.2 adalah satu-satunya penulis
statusnya. `awcms_tenant_entitlements` menjawab "pelanggan ini memegang apa", dan
ia bergerak karena alasan yang sama sekali bukan tagihan: fitur yang
di-grandfather, janji migrasi, kelonggaran dukungan.

Menyatukannya membuat grandfathering (PR 5.3) tak bisa dibedakan dari membayar —
sehingga penurunan plan diam-diam mencabut janji yang tak seorang pun mencatat
pernah dibuat.

Union keduanya di-resolve **saat request**, tidak dimaterialisasi. Cache
"entitlement efektif" dipertimbangkan dan ditolak: penurunan plan yang baru
berlaku pada refresh berikutnya adalah kontrol dengan jendela, dan jendela itu
persis saat seseorang masih menjangkau apa yang sudah berhenti ia bayar.
Pembacaannya satu round trip dengan cara mana pun — `resolveModuleAvailability`
melipat seluruh pertanyaan ke dalam query `awcms_tenant_modules` yang **sudah**
dijalankan chokepoint — jadi cache itu membeli kebasian tanpa imbalan apa pun.

## `past_due` dan `grace` MASIH melayani

`ENTITLING_SUBSCRIPTION_STATUSES` memuat `trialing`, `active`, `past_due`,
`grace`. Memutus layanan pada tagihan pertama yang terlewat membuat anak tangga
tengah menjadi dekorasi — justru keberadaannya adalah supaya pelanggan tetap
dilayani sementara operator mengejar invoice. `suspended` dan `cancelled` di
luar himpunan itu, dan `suspended` adalah tempat gerbang tenant ADR-0073
mengambil alih.

Himpunan itu **konstanta kode dan tidak boleh menjadi kolom**: himpunan status
yang bisa didefinisikan ulang oleh sebuah baris adalah plan wall yang bisa
dihapus oleh sebuah baris.

## Yang DITOLAK

1. **`subject.entitlements` / `env.planTier` sebagai atribut ABAC** — sudah
   ditolak di PROJECT_STATE §4 dan dikuatkan di sini; alasannya di §"Kenapa
   MENOLAK".
2. **Materialisasi entitlement efektif per tenant** — membeli kebasian tanpa
   menghemat round trip.
3. **Riwayat langganan sebagai tabel** — tabel tak-terbatas yang menyamar
   sebagai konfigurasi. Riwayat yang penting (siapa memindahkan tenant ini ke
   plan mana, kapan) adalah audit event yang sudah punya retensinya sendiri.
4. **Katalog plan yang bisa ditulis saat request** — §"Katalog itu GLOBAL".
5. **`requiresEntitlement` sebagai array kondisi** — sebuah bahasa kebijakan di
   jalur deny adalah cara sebuah gerbang deny-only menumbuhkan allow yang tidak
   disengaja. Deployment yang butuh granularitas lebih halus memasang entitlement
   pada lebih banyak MODUL, bukan pada lebih banyak ekspresi.
6. **Membuat cabang ini fail-closed pada sumbu tenant platform** — dibalik
   dengan sengaja; lihat pengecualian 1.
7. **Deskriptor `dataLifecycle` untuk kelima tabel** — purge berbasis umur akan
   menghapus entitlement yang HIDUP. Itu bukan retensi, itu gangguan layanan.
   Kelimanya masuk `BOUNDED_BY_DESIGN` dengan alasan per-tabel.

## Konsekuensi

- `MODULE_CONTRACT_VERSION` naik ke **3.1.0** (aditif murni), dipasangkan bump
  `awcms-family-compatibility.yaml`.
- Rantai `bun run check` menjadi **40 segmen**.
- Tabel `sql/` menjadi **109**; lima tabel baru, tiga di antaranya GLOBAL dan
  karena itu wajib hadir DUA KALI — di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` dan
  di peta hak `security-readiness.ts` — atau `tests/repo-inventory.test.ts`
  memerah dari dua sisi.
- `resolveModuleEnabled` **dipertahankan** di samping
  `resolveModuleAvailability`. Tiga rute merakit ownership grant ADR-0063
  memanggilnya langsung, dan menaruh argumen entitlement di tiga berkas yang
  tidak punya urusan me-resolve-nya akan menyebarkan keputusan ini alih-alih
  memusatkannya — chokepoint yang mereka serahi ownership grant sudah
  memutuskannya.
- PR 5.2 menambahkan `evaluateSubscriptionTransition`; PR 5.3 menambahkan
  backfill grandfathering dan laporan **blast-radius** yang wajib dijalankan
  SEBELUM sebuah deskriptor mendeklarasikan entitlement pertamanya; PR 5.4
  memasang entitlement nyata pertama dan layar `/admin/subscriptions`.
