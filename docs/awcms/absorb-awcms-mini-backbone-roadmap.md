# Roadmap Penyerapan Tulang Punggung awcms-mini → awcms

> **Dibaca lewat kacamata [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md) (2 Agustus 2026):**
> `awcms-mini`/`awcms-micro` kini **arsip**, jadi dokumen ini adalah daftar
> **kebutuhan kapabilitas**, bukan antrean port. Tiap butir masuk lewat **ADR
> admission-nya sendiri dan dibangun di repo ini**; kode arsip boleh dibaca
> sebagai spesifikasi/referensi, bukan sumber yang di-port.

> **Pendamping** [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md), bukan
> penggantinya. Roadmap micro menyerap klaster **website/e-commerce**; dokumen ini
> menyerap klaster **fondasi bisnis + SaaS control plane** dari `awcms-mini`.
> Keduanya berbagi satu antrean penomoran migrasi — kerjakan berurut, satu PR atomic
> per modul.
>
> **Sumber keputusan:** [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> (`awcms` = online-first hybrid, **siap ERP + SaaS terintegrasi**) dan
> [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
> (modul domain hidup **langsung** di `src/modules/`, tanpa repo turunan).
>
> Repo sumber: `awcms-mini` (`/home/data/dev_react/awcms-mini`).

## 1. Temuan yang melahirkan dokumen ini

Audit 2026-07-25 terhadap `docs/adr/` vs `src/modules/` menemukan:

**Lima modul sudah di-`Accepted` oleh ADR di repo INI, tetapi tidak ada kodenya.**

| ADR (status `Accepted` di awcms)                                | Modul yang di-admit       | Ada di `src/modules/`? | Ada di mini? |
| --------------------------------------------------------------- | ------------------------- | ---------------------- | ------------ |
| [0016](../adr/0016-organization-structure-module-admission.md)  | `organization_structure`  | ❌ **tidak**           | ✅ matang    |
| [0017](../adr/0017-document-infrastructure-module-admission.md) | `document_infrastructure` | ❌ **tidak**           | ✅ matang    |
| [0018](../adr/0018-data-exchange-module-admission.md)           | `data_exchange`           | ❌ **tidak**           | ✅ matang    |
| [0019](../adr/0019-integration-hub-module-admission.md)         | `integration_hub`         | ❌ **tidak**           | ✅ matang    |
| [0021](../adr/0021-reference-data-module-admission.md)          | `reference_data`          | ❌ **tidak**           | ✅ matang    |

Selain itu [ADR-0020](../adr/0020-erp-extension-readiness-contracts.md) (kontrak
kesiapan ekstensi ERP) berstatus `Accepted` dan punya
[`erp-extension-contracts.md`](erp-extension-contracts.md), tetapi **tidak ada
implementasinya** di `src/modules/_shared/`.

Ini kebalikan dari mode kegagalan biasa: bukan kode tanpa dokumen, melainkan
**aturan repo yang sudah menjanjikan sebuah lapisan fondasi yang belum pernah
dibangun**. Konsekuensi praktisnya — seorang agen (atau manusia) yang membaca
`docs/adr/` akan menyimpulkan `organization_structure` bisa dipanggil. Tidak bisa.

**Klaster SaaS control plane belum di-admit sama sekali di sini.** Tujuh modul di
mini (`service_catalog`, `tenant_entitlement`, `usage_metering`,
`tenant_provisioning`, `tenant_lifecycle`, `subscription_billing`,
`payment_gateway`) berjalan di bawah **ADR-0022 milik mini**. Nomor 0022 di repo
ini dipakai untuk ADR yang berbeda dan sudah _superseded_
([0022 — modul ERP hidup di repo ekstensi](../adr/0022-erp-modules-live-in-extension-repos.md),
digantikan ADR-0034). Jadi klaster ini **butuh ADR admission baru di awcms**
sebelum baris implementasinya boleh dikerjakan.

## 2. Aturan penyerapan (wajib per modul)

Sama seperti roadmap micro — **adaptasi, bukan salin**:

1. **Delta analysis dulu.** Jangan mundurkan kapabilitas awcms yang sudah lebih maju
   (auth: MFA/OIDC/SSO/ABAC-DSL/business-scope/SoD/Turnstile/break-glass).
2. **Rename prefix** `awcms_mini_` → `awcms_` (tabel, GUC, konstanta, env, katalog
   permission).
3. **Penomoran migrasi lanjut & rapat** dari tertinggi saat ini (per 2026-07-25
   `sql/068`), sekuensial tanpa gap. Gap di mini TIDAK dibawa.
4. **RLS `ENABLE` + `FORCE`** untuk setiap tabel tenant-scoped; uji di bawah role
   `awcms_app` **LOGIN**, bukan superuser — superuser melewati RLS bahkan dengan
   FORCE, jadi verifikasi sebagai superuser membuktikan **nol**.
5. **Opt-in per tenant, default-disabled** — semua modul di dokumen ini adalah
   _Official Optional Business Foundation_. Base yang murni harus tetap jalan tanpa
   satu pun dari modul-modul ini.
6. **Sinkronkan kontrak**: fragment OpenAPI per-modul + bundle (ADR-0026), AsyncAPI
   untuk event baru, snapshot beku add-only.
7. **Test** unit + integration (dua-world) + contract + security; **docs + skill**
   modul; **changeset**; daftarkan di `src/modules/index.ts`.
8. **Lulus `bun run check` PENUH** sebelum PR.

Kenaikan `MODULE_CONTRACT_VERSION` **satu MINOR aditif per seam kontribusi baru**,
selalu disertai pembaruan pin `contracts.moduleDescriptorContractVersion` di
`awcms-family-compatibility.yaml` (atau `family:conformance:check` merah).

## 3. Gelombang & urutan dependensi

### Gelombang A — fondasi bisnis yang SUDAH di-admit (tanpa ADR baru)

Dikerjakan berurut: `reference_data` lebih dulu karena tiga modul berikutnya
mengonsumsi value set-nya.

| #   | Modul                     | ADR admission (sudah ada) | Catatan port                                                                                                                                                                                                     |
| --- | ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `reference_data`          | ADR-0021                  | Value set **GLOBAL** (tanpa `tenant_id`, RLS-exempt yang di-review, ADR-0021 §8) + override per tenant, effective-dated. Perhatikan: pengecualian RLS di sini disengaja dan harus dibawa utuh berikut alasannya. |
| 2   | `organization_structure`  | ADR-0016                  | Legal entity + unit organisasi tenant-scoped. Kosakata ADR-0013 §2/§4 (tenant ≠ legal entity ≠ unit). Bergantung `logging` untuk audit.                                                                          |
| 3   | `document_infrastructure` | ADR-0017                  | METADATA dokumen generik saja — bukan skema dokumen domain. Rekonsiliasi dengan `media_library` yang sudah ada (ADR-0036) agar tidak tumpang tindih kepemilikan berkas.                                          |
| 4   | `data_exchange`           | ADR-0018                  | Import/export CSV/JSON bertahap; descriptor kontribusi per modul, netralisasi formula-injection, commit idempoten resumable.                                                                                     |
| 5   | `integration_hub`         | ADR-0019                  | Webhook masuk bertanda-tangan, HMAC per-endpoint + rotasi overlap, proteksi replay lewat keunikan DB. Cek dulu apakah bertabrakan dengan `sync-storage`.                                                         |

### Gelombang B — SaaS control plane (**butuh ADR admission baru lebih dulu**)

> **Blocker tata kelola.** Tidak satu pun baris di bawah boleh merge sebelum ADR
> admission SaaS control plane awcms di-`Accepted` (mengadaptasi ADR-0022 mini:
> admission, batas, trust model, kontrak lifecycle). Itu preseden yang sama dengan
> yang ditegakkan mini lewat acceptance criterion #869-nya, dan alasannya sama:
> tujuh modul yang saling mengonsumsi kontrak satu sama lain akan mengeras menjadi
> bentuk yang salah bila batasnya baru ditetapkan setelah tiga di antaranya jadi.

Urutan konsumsi kontrak (dari mini) menentukan urutan port:

| #   | Modul                  | Menyediakan / mengonsumsi                                                                                      |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `service_catalog`      | PLAN berversi, OFFER immutable-once-published, grant entitlement, kuota. Fondasi enam lainnya.                 |
| 2   | `tenant_entitlement`   | Resolusi entitlement efektif per tenant. "Jantung" klaster.                                                    |
| 3   | `usage_metering`       | Event meter numerik lewat port `usage_append` (tabel event = outbox transaksional).                            |
| 4   | `tenant_provisioning`  | Run provisioning idempoten & resumable. **Titik sambung subdomain otomatis** (§4).                             |
| 5   | `tenant_lifecycle`     | State machine lifecycle SaaS; kontrak `lifecycle_transition`.                                                  |
| 6   | `subscription_billing` | Langganan, periode, invoice immutable, credit note, dunning. Uang = **minor unit bigint**, tidak pernah float. |
| 7   | `payment_gateway`      | Sesi checkout hosted, webhook bertanda-tangan. Mode LAN/offline/manual tetap jalan tanpa gateway online.       |

### Gelombang C — kontrak kesiapan ERP (ADR-0020) benar-benar diimplementasikan

ADR-0020 `Accepted` tetapi tanpa kode. Implementasikan seam-nya di
`src/modules/_shared/` (business transaction, posting, period-lock, item,
report-projection) supaya klaim "siap ERP" di README/PROJECT_STATE punya sandaran.

### Gelombang D — opsional, khusus Indonesia

`idn_admin_regions` (master wilayah provinsi/kabupaten/kecamatan/desa). Sumbernya
dataset komunitas pihak ketiga (MIT), **bukan** API resmi Kemendagri — caveat itu
wajib ikut ter-port, jangan dihaluskan.

## 4. Titik sambung: subdomain tak terbatas berbasis Cloudflare DNS

`tenant_domain` **sudah ada** di awcms (PR #219, `sql/046`–`048`): skema
`awcms_tenant_domains`, API manajemen, layar admin, resolver host publik, dan
adapter Cloudflare opsional di
`src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter.ts`.

**Yang belum ada** — dan ini yang membuat "pengelolaan unlimited sub domain" belum
utuh:

1. **Adapter Cloudflare belum dipanggil rute mana pun.** Ia absent-safe dan teruji,
   tetapi tidak ada alur yang benar-benar membuat record DNS. Menambah domain hari
   ini = pencatatan di DB + verifikasi manual.
2. **Rute publik ber-resolusi-host belum disambungkan.** `src/middleware.ts`
   sengaja tidak disentuh saat port #219; resolusi host adalah urusan per-rute
   publik.
3. **Provisioning subdomain otomatis** secara alami milik `tenant_provisioning`
   (Gelombang B #4): "tenant baru → subdomain → record DNS → verifikasi" adalah satu
   run provisioning idempoten & resumable, bukan endpoint sekali-jalan.

**Urutan yang disarankan:** sambungkan adapter Cloudflare + rute publik
ber-resolusi-host **sebagai PR tersendiri lebih dulu** (tidak bergantung Gelombang
B), lalu `tenant_provisioning` mengorkestrasinya. Membalik urutan berarti menulis
langkah provisioning terhadap seam yang belum terbukti.

> Catatan cache: begitu subdomain tak terbatas aktif, kunci cache tepi
> ([ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md)) **wajib**
> menyertakan Host — sudah ditegakkan di `vcl_hash`. Tanpa itu setiap tenant
> berbagi satu entri cache untuk path yang sama.

## 5. Status penyerapan (perbarui saat selesai)

| Gel. | Item                                     | Status                                                              | PR  |
| ---- | ---------------------------------------- | ------------------------------------------------------------------- | --- |
| A    | `reference_data` (ADR-0021)              | ⏳ belum — ADR sudah `Accepted`, kode belum ada                     | —   |
| A    | `organization_structure` (ADR-0016)      | ⏳ belum — ADR sudah `Accepted`, kode belum ada                     | —   |
| A    | `document_infrastructure` (ADR-0017)     | ⏳ belum — ADR sudah `Accepted`, kode belum ada                     | —   |
| A    | `data_exchange` (ADR-0018)               | ⏳ belum — ADR sudah `Accepted`, kode belum ada                     | —   |
| A    | `integration_hub` (ADR-0019)             | ⏳ belum — ADR sudah `Accepted`, kode belum ada                     | —   |
| B    | **ADR admission SaaS control plane**     | ⏳ belum — **memblokir seluruh Gelombang B**                        | —   |
| B    | 7 modul control plane                    | ⏳ belum                                                            | —   |
| C    | Implementasi kontrak ERP (ADR-0020)      | ⏳ belum — ADR + docs ada, kode `_shared` belum                     | —   |
| D    | `idn_admin_regions`                      | ⏳ belum (opsional)                                                 | —   |
| —    | Wiring Cloudflare DNS + rute host publik | ⏳ belum — adapter ada, tak dipanggil; `middleware.ts` tak disentuh | —   |
