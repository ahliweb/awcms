# ADR-0034 — Keluarga AWCMS sebagai template dipakai-LANGSUNG untuk pengembangan apa pun, dan penghapusan jalur aplikasi-turunan

- **Status:** Accepted
- **Tanggal:** 2026-07-21
- **Pengambil keputusan:** @ahliweb
- **Men-supersede:** [ADR-0013](0013-extension-layers-and-boundary-model.md) (lapisan Derived Application), [ADR-0014](0014-deterministic-build-time-module-composition.md) (komposisi build-time untuk aplikasi turunan / `application-registry.ts`), [ADR-0015](0015-derived-application-compatibility-manifest.md) (manifest kompatibilitas turunan + `extension:check`), [ADR-0022](0022-erp-modules-live-in-extension-repos.md) (modul domain hidup di repo ekstensi), [ADR-0025](0025-implement-deterministic-build-time-module-composition.md) (implementasi komposisi untuk registry base + aplikasi turunan). Menegaskan kembali: konvensi teknis inti (ADR-0001 Bun-only/RLS/RBAC-ABAC, ADR-0003 RLS, ADR-0004 default-deny, ADR-0011 capability ports).
- **Selaras dengan:** awcms-micro `ADR-0034` (template dipakai-langsung, deprecation jalur turunan) dan `ADR-0035` (mekanisme komposisi base tetap ada) — dokumen ini menyelaraskan keputusan itu ke seluruh keluarga (lihat §5), dengan awcms mengambil langkah lebih jauh: **menghapus** permukaan jalur-turunan, bukan sekadar men-deprecate.

## Konteks

Epic #177 dan pilot #187 membangun **jalur aplikasi-turunan**: `awcms` dipakai sebagai fondasi yang di atasnya dibangun aplikasi domain di **repo terpisah** (mis. `awcms-erp-pilot`) lewat seam `src/modules/application-registry.ts` + migration namespace 900–999 + manifest kompatibilitas + gerbang `bun run extension:check`. ADR-0022 bahkan menetapkan bahwa modul domain (termasuk seluruh modul konten/website) **tidak boleh** hidup di `src/modules/` base, melainkan di repo ekstensi.

Dua konsekuensi yang tidak diinginkan:

1. **Repo derivatif menambah lapisan tanpa manfaat setara.** Untuk membangun apa pun, model "buat repo turunan terpisah di atas base" mewajibkan registry aplikasi, penomoran migrasi khusus, manifest kompatibilitas, dan gate yang harus dipelihara — padahal untuk banyak kebutuhan cukup **memakai repo template secara langsung** dan menambah modul di dalamnya.
2. **Ketiga repo keluarga sebenarnya adalah template yang berdiri sendiri.** `awcms-mini` (standar modular-monolith), `awcms` (fondasi ERP + solusi back-office), dan `awcms-micro` (website full-online hingga toko online) masing-masing sudah lengkap sebagai titik-awal. awcms-micro sudah menyatakan sikap ini (ADR-0034/0035 miliknya). Framing "base wajib + turunan terpisah" bertentangan dengan kenyataan itu.

## Keputusan

### 1. Tiga repo keluarga = template dipakai-LANGSUNG untuk pengembangan apa pun

`awcms-mini`, `awcms`, dan `awcms-micro` adalah **tiga template dasar yang sejajar**, masing-masing **dipakai langsung** sebagai titik awal pengembangan — bukan basis-turunan-wajib yang di atasnya harus dibangun repo aplikasi terpisah. Perbedaan mereka adalah **scope/lineage**, bukan hierarki:

| Repositori    | Peran (dipakai langsung)           | Scope                                        |
| ------------- | ---------------------------------- | -------------------------------------------- |
| `awcms-mini`  | Template standar modular-monolith  | Fondasi reusable generik                     |
| `awcms`       | Template lineage ERP / back-office | ERP, solusi bisnis, dan pengembangan apa pun |
| `awcms-micro` | Template website full-online       | Situs konten hingga toko online (e-commerce) |

Cara pakai utama: **fork/gunakan repo yang scope-nya paling dekat, lalu kembangkan modul langsung di dalamnya.** Warisan konvensi antar-repo tetap dicatat (Bun-only, RLS/FORCE, RBAC/ABAC default-deny, kontrak OpenAPI/AsyncAPI, gate CI), tetapi tidak ada repo yang diposisikan sebagai "turunan yang wajib mem-port dari repo lain secara berkelanjutan".

### 2. TIDAK membuat repo derivatif

Pengembangan baru **tidak** dilakukan dengan membuat repo aplikasi-turunan terpisah di atas salah satu template. Modul domain — termasuk modul konten/website — **boleh dan seharusnya** hidup langsung di `src/modules/` template yang dipakai. Ini men-supersede ADR-0022 (yang melarang modul domain di base): pembatasan itu dicabut.

### 3. Jalur aplikasi-turunan di `awcms`: DIHAPUS

Berbeda dari awcms-micro yang men-deprecate (ADR-0034 miliknya) lalu **menahan** kodenya (ADR-0035, karena mekanisme komposisi = infrastruktur base load-bearing), `awcms` **menghapus** permukaan yang **khusus jalur-turunan**:

- Seam turunan `src/modules/application-registry.ts` (yang selalu `undefined` di base), gerbang `bun run extension:check`, dan fixture `tests/fixtures/derived-application-example`.
- Konsep migration namespace turunan (900–999) dan manifest kompatibilitas turunan (`extension.manifest.json`, ADR-0015).

**Yang DIPERTAHANKAN** karena load-bearing base (bukan derived-only, dipakai perakitan registry base, SoD, reporting, conformance): `src/modules/index.ts` `listModules()`, kontrak `ModuleDescriptor`/`defineModule` (`_shared/module-contract.ts`), `module-management`, dan validasi komposisi base sejauh ia memeriksa **registry base sendiri** (bukan registry aplikasi turunan). Penghapusan dilakukan sebagai langkah **evidence-gated** terpisah (PR sendiri, `bun run check` + CI penuh hijau) — bukan di ADR ini; ADR ini adalah keputusannya.

### 4. Dokumen & issue jalur-turunan: usang

`docs/awcms/derived-application-guide.md`, `derived-app-pilot-plan.md`, `derived-app-pilot-purchase-requisition-plan.md`, dan `derived-app-pilot-purchase-requisition-execution.md` ditandai **DEPRECATED** (menunjuk ADR ini). Issue #187 (pilot derived ERP) dan bagian pilot-turunan dari EPIC #177 ditutup sebagai usang; kapabilitas fondasi yang sudah selesai dan bernilai (authorization ABAC/SoD/business-scope #179–#181, kontrak OpenAPI modular #182, conformance #183) **tetap** — hanya premis "repo turunan terpisah" yang dicabut.

### 5. Harmonisasi lintas keluarga

Sikap yang sama diterapkan ke ketiga repo (langkah terpisah per-repo):

- **awcms-micro:** sudah pada posisi ini (ADR-0034/0035 miliknya). Diselaraskan ke framing "tiga template sejajar + tidak membuat repo derivatif". Penghapusan kode komposisi **tidak** dipaksakan di sini — ADR-0035 miliknya sudah membuktikan mekanisme itu load-bearing; hanya narasi/positioning yang diselaraskan.
- **awcms-mini:** direposisi dari "base yang di atasnya dibangun aplikasi turunan" menjadi "template standar dipakai-langsung"; dokumen/ADR jalur-turunan (ADR-0013/0015) di-deprecate; penghapusan kode mengikuti kenyataan load-bearing per-repo (seperti micro).
- **awcms:** dokumen ini + penghapusan penuh permukaan derived-only (§3).

## Konsekuensi

- **Positif:** tidak ada lapisan repo-turunan wajib; pengembangan langsung di template; modul website boleh masuk base (`no-content-website-modules` dicabut, membuka jalan implementasi langsung modul website mis. `theming`).
- **Ditegakkan terpisah:** (a) penghapusan kode/gate derived-only di `awcms` (§3) — PR evidence-gated; (b) implementasi langsung modul website pertama (`theming`, diadaptasi dari awcms-micro); (c) pembaruan `awcms-family-compatibility.yaml` (mencabut divergence `no-content-website-modules`, menyesuaikan `module-type-without-derived`); (d) reposisi README/AGENTS; (e) harmonisasi mini/micro.
- **Tidak berubah:** seluruh konvensi runtime (Bun-only, RLS/FORCE, RBAC/ABAC default-deny, kontrak, registry base saat ini, gate CI non-derived). ADR ini mengubah **model pemakaian & tata kelola**, bukan arsitektur runtime.
