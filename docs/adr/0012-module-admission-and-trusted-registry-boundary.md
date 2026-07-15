# ADR-0012 — Module admission categories dan trusted static registry boundary

- **Status:** Accepted
- **Tanggal:** 2026-07-12
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #696 (epic #679, platform-hardening), Issue #510 (epic Module Management), `docs/awcms/21_module_admission_governance.md` (detail lengkap), ADR-0001, ADR-0002, ADR-0008, ADR-0011

> **Catatan currency (2026-07-13).** Angka "14 modul" di Konteks/Keputusan
> di bawah adalah snapshot saat ADR ini di-Accept (Issue #696) dan
> **sengaja tidak diperbarui di sini** — kebijakan `docs/adr/README.md`:
> ADR yang sudah Accepted tidak ditulis ulang diam-diam saat fakta
> bergeser, hanya lewat ADR baru/superseding. Jumlah modul terdaftar
> sudah bertambah sejak itu (16 modul, dikonfirmasi `bun run
modules:dag:check`); figur terkini dan pemetaan kategori dua modul yang
> lebih baru (`social_publishing`, `idn_admin_regions`) ada di
> `docs/adr/0013-extension-layers-and-boundary-model.md` §1 dan
> `docs/awcms/21_module_admission_governance.md` §8 — rujuk keduanya
> untuk angka terkini, bukan angka di bawah.

## Konteks

Registry modul (`src/modules/index.ts`) tumbuh dari base generik ke 14
modul terdaftar, termasuk dua modul domain nyata (`blog_content`,
`news_portal`) yang sebelumnya didokumentasikan sebagai "pengecualian
tunggal" (`AGENTS.md` §Peta modul) — kini sudah ada dua, dan roadmap
menyebut modul region/Hermes berikutnya. Tanpa kriteria admission eksplisit,
tidak jelas kapan sebuah kemampuan baru boleh masuk repo base ini, kategori
apa yang berlaku (dan aturan dependency/security-review/ownership/
deprecation yang mengikutinya), serta di mana batas keras terhadap kode
pihak ketiga yang dieksekusi saat runtime.

## Keputusan

Kami memutuskan:

1. **Lima kategori modul**: Core, System, Official Optional Module,
   Derived Application, External Integration — definisi lengkap, pohon
   keputusan admission, kriteria per kategori, aturan dependency
   (required vs optional capability), ekspektasi kompatibilitas
   offline/LAN vs full-online-only, security review checklist, ownership,
   dan kebijakan deprecation/removal ada di
   `docs/awcms/21_module_admission_governance.md` — dokumen ini
   merangkum keputusan mengikatnya, bukan menduplikasi detailnya.
2. **Registry tetap trusted dan statis** — `src/modules/index.ts` adalah
   satu-satunya sumber modul, dikompilasi ke satu binary monolith, direview
   lewat PR + CI normal. `awcms_tenant_modules` hanya menyimpan status
   enable/disable boolean untuk kode yang SUDAH ADA di binary yang
   berjalan, tidak pernah memuat/mengeksekusi kode baru saat runtime.
3. **Larangan eksplisit**: marketplace modul, upload plugin/tema/skrip
   tenant, dynamic import dari path/URL yang berasal dari input
   tenant/user, atau `eval`/`Function()` yang mengeksekusi teks eksternal —
   tidak diperkenalkan dan tidak akan diperkenalkan tanpa ADR baru yang
   secara eksplisit mensupersede ADR-0001 (modular monolith) dan/atau
   ADR-0002 (Bun-only runtime tanpa sandbox eksekusi kode asing).
4. 14 modul terdaftar saat ini dipetakan ke kategori di atas (3 Core, 9
   System, 2 Official Optional Module, 0 Derived Application/External
   Integration top-level) — lihat doc 21 §8 untuk tabel lengkap dan
   remediasi (gap `type`/`isCore`/`maintainers` field) yang terdeteksi
   selama pemetaan ini.
5. Proposal ringan (`docs/awcms/templates/
module-proposal-template.md`) dan checklist review
   (`docs/awcms/templates/module-admission-decision-checklist.md`)
   ditambahkan sebagai triase awal sebelum ADR penuh untuk modul baru.

## Konsekuensi

- **Positif:** kontributor (manusia atau agent) punya pohon keputusan
  eksplisit untuk memutuskan apakah kemampuan baru masuk base ini atau
  aplikasi turunan, kategori apa yang berlaku, dan checklist apa yang
  harus lolos — mengurangi ambiguitas yang sebelumnya hanya implisit dari
  membaca kode modul yang sudah ada satu per satu.
- **Positif:** larangan runtime code execution/marketplace kini
  didokumentasikan eksplisit sebagai keputusan sadar, bukan sekadar "belum
  dibangun" — proposal masa depan yang mengarah ke sana punya bar
  penolakan yang jelas (ADR baru mensupersede ADR-0001/0002) alih-alih
  didiskusikan dari nol setiap kali diusulkan.
- **Negatif/trade-off:** dokumen ini murni governance/dokumentasi —
  gap remediasi yang terdeteksi saat memetakan 14 modul (field `type` yang
  tidak konsisten diisi, `isCore` hanya di satu modul, `maintainers` belum
  pernah diisi) TIDAK diperbaiki di kode oleh ADR/PR ini, hanya dicatat
  sebagai follow-up (doc 21 §8) — risiko drift antara dokumen dan kode
  tetap ada sampai follow-up itu dikerjakan.
- **Netral:** kategori "Derived Application" dan "External Integration"
  didefinisikan tapi tidak punya entri top-level di registry base ini hari
  ini (External Integration hidup sebagai sub-komponen modul pemilik,
  Derived Application selalu di luar repo ini) — keputusan ini tidak
  mengubah `ModuleType` union atau menambah entri registry baru sama
  sekali.

## Alternatif yang dipertimbangkan

- **Biarkan admission implisit, cukup rely on code review manual** —
  ditolak: epic #679 secara eksplisit menandai kurangnya kriteria admission
  eksplisit sebagai risiko sebelum modul produk baru (region/Hermes)
  masuk base; review manual tanpa kriteria tertulis tidak konsisten antar
  reviewer/waktu.
- **Membangun sistem plugin/marketplace nyata sekarang, dengan sandbox
  eksekusi** — ditolak eksplisit: bertentangan langsung dengan ADR-0001
  (modular monolith tepercaya) dan ADR-0002 (Bun-only, tanpa sandbox
  eksekusi kode asing); tidak ada kebutuhan bisnis konkret hari ini yang
  membenarkan kompleksitas dan permukaan serangan sebesar itu.
- **Menambah nilai `"core"` eksplisit ke `ModuleType` union sekarang** —
  ditunda: mengubah tipe (`_shared/module-contract.ts`) dan mengisi ulang
  9+ descriptor sekaligus melebihi scope docs-only Issue #696 (atomic);
  dicatat sebagai remediasi R1 (doc 21 §8) untuk issue kode terpisah.
