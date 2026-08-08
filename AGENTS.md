# AGENTS.md — Panduan Agent & Kontributor AWCMS

## Ringkasan proyek

AWCMS adalah **template lini ERP/back-office keluarga AWCMS** milik AhliWeb, **dipakai LANGSUNG** sebagai titik awal pengembangan, bukan basis-turunan-wajib ([ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), men-supersede ADR-0013/0014/0015/0022/0025). Mode operasinya **hybrid online + offline dengan prioritas online-first** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS terintegrasi**, dan ia adalah template **superset** keluarga ([ADR-0035](docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md), menyempurnakan positioning ADR-0034).

**Keluarga hari ini dua repo, dan hanya dua** ([ADR-0055](docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md)): repo ini sebagai **system of record**, dan [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) sebagai **halaman publik + permukaan admin USER** ([ADR-0070](docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)). Pasangan keduanya adalah **pengganti multiguna** dari ketiga template lama. `awcms-mini` dan `awcms-micro` **ARSIP** — tidak dilanjutkan, bukan standar, bukan sumber port; rinciannya di §"Di repo mana pekerjaan dilakukan" di bawah.

Asal-usulnya tetap fakta: repo ini **dahulu** dibangun ulang (lihat [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) di atas basis teknologi **awcms-mini** — _modular monolith standard_ Bun + Astro 7 + PostgreSQL/RLS — dan sebagian klaster website/e-commerce, UI/UX, serta pengerasan auth-nya **diserap dari** `awcms-micro`. Nama kedua repo itu karena itu masih muncul di seluruh repo ini sebagai **provenance**; itu catatan sejarah yang benar selamanya, bukan pekerjaan yang tertunda.

Modul domain ERP (keuangan, inventori, procurement, manufaktur, HR/payroll), modul website/e-commerce, dan integrasi dengan solusi bisnis eksternal (payment gateway, marketplace, Coretax, logistik) **ditambahkan langsung di `src/modules/` template ini** saat dipakai — bukan di repo turunan terpisah, dan bukan di-port dari repo arsip — di atas kontrak netral kesiapan ERP yang base sediakan ([ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md), [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md)).

Baca dokumen ini sebelum mengerjakan task apa pun di repo ini. Ini adalah kontrak kerja teknis — aturan wajib, guardrail keamanan, dan alur task.

## Di repo mana pekerjaan dilakukan (wajib dibaca)

> **Sejak 2 Agustus 2026 ([ADR-0055](docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md), men-supersede ADR-0047):**
> pengembangan AWCMS berlangsung di **dua repositori, dan hanya dua**:
>
> | Repo                       | Peran                                                                                                                                                                                                                                                                                                                                        |
> | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `ahliweb/awcms` (repo ini) | **System of record** — modular monolith, seluruh permukaan otorisasi, seluruh API, dan seluruh layar admin **SISTEM** ([ADR-0051](docs/adr/0051-admin-screens-consolidated-in-awcms.md), dipersempit [ADR-0070](docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md))                                                  |
> | `ahliweb/awcms-astro`      | **Halaman publik sebagai fungsi utama**, dan **permukaan admin USER bila situsnya menyatakannya** ([ADR-0070](docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)); tetap experience layer + BFF ([ADR-0045](docs/adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md)) dan **tak pernah sumber kebenaran** |
>
> Keduanya bersama-sama adalah **pengganti multiguna** dari ketiga template lama
> — bukan salah satunya sendirian.
>
> **`awcms-mini` dan `awcms-micro` adalah ARSIP.** Bukan standar, bukan sumber
> port, bukan template keluarga. Boleh dibaca sebagai referensi sejarah, tetapi
> **tidak ada pekerjaan yang dijadwalkan "di-port dari" sana**. Kemampuan yang
> diinginkan **dibangun di sini**, dengan ADR admission-nya sendiri, dinilai
> dari kebutuhan hari ini — bukan dari apa yang kebetulan sudah ada di repo lain.
>
> Aturan mini-first **dicabut**, bukan ditangguhkan. Dokumen
> [`alur-pengembangan-mini-first.md`](docs/awcms/alur-pengembangan-mini-first.md)
> dipertahankan sebagai catatan sejarah.
>
> **Ini bukan pelonggaran.** Penjagaan yang dulu dibawa jalur mini-first tetap
> wajib: **ADR untuk perubahan standar**, review keamanan tambahan untuk modul
> `auth`/`access`/`sync`, `bun run check` penuh termasuk
> `family:conformance:check`, OpenAPI/AsyncAPI sinkron, RLS `FORCE`, ABAC
> default-deny, dan migrasi terapan immutable. Satu-satunya yang dicabut adalah
> kewajiban mencatat tiap fitur fondasi sebagai _divergence_ di
> `awcms-family-compatibility.yaml` — **ADR-nya sendiri yang kini menjadi
> catatan itu**, dan duplikatnya hanya menjadi hal kedua yang harus dijaga
> sinkron.

Conformance terhadap standar keluarga ini bersifat machine-readable dan ditegakkan CI: manifest [`awcms-family-compatibility.yaml`](awcms-family-compatibility.yaml) + gate `bun run family:conformance:check` (bagian dari `bun run check`). Bila perubahanmu menyentuh versi kontrak (module/capability/OpenAPI/AsyncAPI), versi stack, semantik kontrol reusable (default-deny/RLS/redaction/audit/idempotency/envelope/migration-immutability), atau menambah divergence sengaja dari kontrak yang repo ini ikuti — perbarui manifest + jalankan gate; lihat [`docs/awcms/family-compatibility.md`](docs/awcms/family-compatibility.md).

## Di repo mana sebuah LAYAR dibangun (ADR-0051, dipersempit ADR-0070)

**Semua layar admin SISTEM dibangun di repo ini**, di bawah satu shell
`/admin/*` — tenant maupun owner/internal/platform.
[ADR-0051](docs/adr/0051-admin-screens-consolidated-in-awcms.md) men-supersede
ADR-0048 (yang dulu menaruh layar owner/internal di `awcms-astro`).

**Batasnya APA YANG DIKELOLA, bukan siapa yang memakainya**
([ADR-0070](docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md),
mempersempit kata "seluruh" di ADR-0051 — bukan men-supersede-nya):

| Repo          | Peran                                                                       | Contoh                                                                              |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `awcms` (ini) | **seluruh admin SISTEM** + permukaan publiknya sendiri                      | modul, peran/izin, tenant, jejak audit, apa pun lintas-tenant; `/blog/*`, `/search` |
| `awcms-astro` | **halaman publik** (fungsi utama) + **admin USER** bila situsnya menyatakan | situs publik/Jualanku; menulis artikel, mengajukan tinjauan, profil sendiri         |

- **Admin SISTEM** mengubah sesuatu **di luar isi satu situs**. Selalu di sini.
- **Admin USER** dipakai seseorang untuk mengerjakan **bagiannya sendiri di satu
  situs**. Boleh di `awcms-astro`, dan hanya bila situs itu menyatakannya lewat
  `permukaanAdmin`. **`owner` ditolak gerbang di sana.**
- **Tidak ada kemampuan yang hanya ada di sana.** Setiap fitur yang dijangkau
  USER wajib juga bisa dikelola dari `/admin/*` di sini — jadi urutan kerjanya
  **`awcms` dulu, selalu**.

### Kosakata URL publik dibelah ([ADR-0071](docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md))

Satu keluarga rute per repo, **dan tidak pernah keduanya di satu repo**:

| Kosakata   | Repo          | Bentuknya                                                                   |
| ---------- | ------------- | --------------------------------------------------------------------------- |
| `/blog/**` | `awcms` (ini) | `/blog/{tenantCode}/**` — path-scoped, ADR-0009                             |
| `/news/**` | `awcms-astro` | sebuah tab bernama `news` ber-`urutanSeksi: "terbaru"` (ADR-0033 repo sana) |

Yang dibelah adalah **URL, bukan kepemilikan konten**: keduanya dilayani modul
`blog_content` yang sama di sini, dan repo sebelah membacanya lewat
`GET /api/v1/blog/posts` (beku, ADR-0065). **Jangan menambah rute publik
`/news/**` di repo ini** — ADR-0071 men-supersede ADR-0059 yang dulu
membolehkannya.

> **Jendela yang masih terbuka.** Empat rute `/news/**` ADR-0059 MASIH ADA di
> `src/pages/news/` dan `publicRouteMode` masih `domain_default` (menyala secara
> bawaan). ADR-0071 §4 menjadwalkan penghapusannya beserta 301-nya ke
> `/blog/{tenantCode}/**`; `tests/url-vocabulary-split.test.ts` menegakkan jadwal
> itu dua arah, jadi jendelanya tidak bisa terlupakan.

Tiga hal yang mudah keliru:

- **Repo bukan gerbang keamanan.** ADR-0048 memindahkan _layar_ aktivasi dataset
  ke repo lain, tetapi _permission_-nya tetap di-seed ke role `owner` setiap
  tenant — jadi pemisahan itu tidak pernah menahan apa pun. Aksi yang efeknya
  **melintasi batas tenant** wajib punya **gerbang platform-scoped** di repo ini,
  dan **tidak boleh** masuk katalog yang di-seed ke role tenant (ADR-0051
  §Keputusan). Berlaku sekarang untuk `idn_admin_regions.dataset.configure`/`.restore`.
- **Setiap entri `navigation` wajib punya halaman nyata.** Sidebar dibangun dari
  `listModules()`; entri yang menunjuk halaman tak-ada langsung memerahkan
  `tests/admin-navigation-registry.test.ts` — dan kalau lolos, ia menjadi 404
  permanen di menu. Tambahkan entri `navigation` **dalam perubahan yang sama**
  dengan layarnya, tidak sebelumnya.
- **Setiap entri non-core wajib punya `requiredPermission`** yang benar-benar
  ditegakkan endpoint-nya **dan** di-seed migrasi. Permission yang tak pernah
  di-seed men-deny bahkan owner sementara kodenya terlihat benar — repo ini sudah
  pernah kena dua kali (lihat `tests/admin-security-page-contract.test.ts`).

## Alur kerja wajib setiap task

1. Mulai dari issue/ADR yang jelas scope-nya. Bila mengubah standar dasar, buat ADR dulu (lihat [`GOVERNANCE.md`](GOVERNANCE.md)).
2. **Buat branch baru dari `main` SEBELUM menyentuh kode.** Setiap implementasi issue GitHub wajib dikerjakan di branch tersendiri — **jangan pernah commit langsung ke `main`** (branch protection menolak push langsung; lihat [`docs/awcms/branch-protection.md`](docs/awcms/branch-protection.md)). Penamaan: `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<topik>`, atau `security/<issue>-<slug>` — mis. `git switch -c feature/178-module-composition`. Satu branch = satu issue/PR; jangan menumpuk beberapa issue tak-berkaitan di satu branch. Detail alur di [`CONTRIBUTING.md`](CONTRIBUTING.md) §Alur kontribusi.
3. Identifikasi dampak: schema (migration), API (OpenAPI), event (AsyncAPI), akses (RBAC/ABAC/RLS), mutation high-risk (idempotency), aksi sensitif (audit), data sensitif (masking).
4. Kerjakan atomic — satu PR = satu perubahan yang jelas dan terisolasi.
5. Tulis test yang gagal sebelum fix, lulus sesudahnya.
6. Perbarui dokumentasi (OpenAPI/AsyncAPI/docs/awcms) dan changeset bila perilaku berubah.
7. Validasi lokal **`bun run check` PENUH** sebelum membuka PR — bukan subset. `check` mencakup `lint` (prettier `--check`) dan `build`; melewati keduanya adalah penyebab tersering "hijau lokal, merah di CI" (`.github/workflows/ci.yml` menjalankan keduanya). Jalankan `bun run format` dulu bila perlu, lalu `bun run check`.
8. Buka Pull Request dengan `Closes #<issue>`; merge hanya setelah review + CI hijau, lalu bersihkan branch.

## Aturan wajib (non-negotiable)

- **Bun-only.** Tidak ada Node.js/npm/pnpm/yarn kecuali ada exception tertulis yang disetujui maintainer.
- **PostgreSQL + RLS wajib** untuk setiap tabel tenant-scoped di base ini, maupun entitas bisnis pada modul domain ERP yang ditambahkan (ledger, payroll, inventory, dst.).
- **RBAC + ABAC default-deny** pada semua endpoint non-public.
- **Idempotency** wajib pada mutation high-risk — di base ini: sync/integrasi eksternal, aksi admin sensitif (access assignment, dst.); pada modul domain ERP: posting transaksi finansial, payroll run, cancel/return, stock adjustment, warehouse transfer.
- **Audit trail dengan redaksi** untuk aksi high-risk — di base ini: login, access assignment, resolusi konflik sync; pada modul domain ERP: price/ledger change, transaksi posted/cancel/return, stock adjustment.
- **Soft delete** untuk resource yang deletable; **immutability** untuk data yang sudah posted/final (mis. jurnal yang sudah posted tidak diedit, hanya dikoreksi lewat entri baru — berlaku pada modul domain ERP yang punya konsep posting).
- **Kontrak API/event wajib**: OpenAPI untuk REST, AsyncAPI untuk domain event, disinkronkan setiap perubahan.
- **Masking data sensitif**: data finansial/personal (NPWP, NIK, gaji, rekening bank) tidak boleh tampil polos di log atau response tanpa alasan eksplisit.
- **Outbox/queue untuk integrasi eksternal** — payment gateway, marketplace, Coretax, logistik (biasanya diimplementasikan modul domain ERP di atas mekanisme outbox base ini) terhubung lewat outbox, bukan panggilan sinkron langsung dari jalur transaksi kritikal.

## Guardrail keamanan

- Tidak ada secret/kredensial/dump database/data bisnis-finansial asli dalam kode, commit, issue, atau dokumentasi.
- Modul sensitif (auth, access, sync, finance, hr-payroll) memerlukan review keamanan tambahan sebelum merge.
- Laporan kerentanan mengikuti [`SECURITY.md`](SECURITY.md) — tidak ada issue publik untuk kerentanan yang bisa dieksploitasi.

## Struktur repository (target)

```
src/
  modules/
    <module>/
      module.ts
      domain/
      application/
      infrastructure/
      api/
tests/
scripts/
sql/
openapi/
asyncapi/
docs/
  adr/
  awcms/
```

## Peta modul

Per [ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (men-supersede ADR-0022), keluarga AWCMS adalah template dipakai-langsung: modul domain ERP, website/e-commerce, dan integrasi bisnis vertikal **boleh & seharusnya** hidup langsung di `src/modules/` template ini saat dipakai. Sebagai template lini ERP yang **di-ship** dan **superset online-first** ([ADR-0035](docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)), `src/modules/` base saat ini berisi modul **fondasi reusable** + kontrak kesiapan ERP + modul website/konten (`theming`/`blog-content` — `news_portal` sudah **dilebur** ke `blog_content`, [ADR-0044](docs/adr/0044-merge-news-portal-into-blog-content.md)). Kapabilitas website/e-commerce lain yang belum ada **dibangun di sini dengan ADR admission-nya sendiri**, bukan di-port dari `awcms-micro` — jalur port itu ditutup [ADR-0055](docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md) §1, dan [`docs/awcms/absorb-awcms-micro-roadmap.md`](docs/awcms/absorb-awcms-micro-roadmap.md) kini dibaca sebagai catatan sejarah. Kontrak kesiapan ERP ada di [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).

| Kategori                                                     | Modul                                                                                                                                                                                                                                                                                                                                                                      | Hidup di                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Fondasi (base ini, `src/modules/`)                           | Tenant Admin, Identity Access, Profile Identity, Logging, Module Management, Sync Storage, Workflow Approval, Reporting, Email, Domain Event Runtime, Theming, Blog Content (menyerap News Portal — [ADR-0044](docs/adr/0044-merge-news-portal-into-blog-content.md)), Idn Admin Regions — lihat [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) untuk daftar hidup terkini | Repo ini                                                              |
| Website/e-commerce (diserap dari awcms-micro)                | Media Library, Tenant Domain, Form Drafts, SEO Distribution, Site Search, Comments, Newsletter, Social Publishing, Visitor Analytics, Data Lifecycle; trajektori toko online (katalog/keranjang/checkout)                                                                                                                                                                  | `src/modules/` (dibangun di sini, satu ADR admission per kapabilitas) |
| ERP — Finance/Inventory/Procurement/Manufacturing/HR-Payroll | General ledger, AP/AR, tax/Coretax export, warehouse, stock adjustment, purchase order, BOM, payroll run, dst.                                                                                                                                                                                                                                                             | `src/modules/` (ditambahkan saat template dipakai)                    |
| Integrasi bisnis vertikal                                    | Payment gateway, marketplace, logistik, Coretax                                                                                                                                                                                                                                                                                                                            | `src/modules/` (ditambahkan saat template dipakai)                    |

Modul fondasi baru mengikuti urutan: tenant/identity/access dulu, lalu modul fondasi lain yang bergantung padanya. Modul domain ERP/integrasi ditambahkan langsung di `src/modules/` template ini ([ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)) di atas kontrak kesiapan ERP yang base ini sediakan.

## Konvensi commit

Format [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <ringkasan>`. Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md) untuk daftar type dan scope.

## Definition of Done

Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md#definition-of-done).

## Peta dokumen

- [`README.md`](README.md) — gambaran umum & arah rebuild.
- [`GOVERNANCE.md`](GOVERNANCE.md) — tata kelola & pengambilan keputusan.
- [`docs/adr/`](docs/adr/README.md) — keputusan arsitektural (fondasi & batas ekstensi ERP).
- [`docs/awcms/`](docs/awcms/README.md) — paket dokumen teknis detail per modul fondasi (PRD/SRS/ERD/OpenAPI/AsyncAPI) dan kontrak kesiapan ERP untuk modul domain yang ditambahkan.
- [`docs/awcms/alur-pengembangan-mini-first.md`](docs/awcms/alur-pengembangan-mini-first.md) — **catatan sejarah**: kontrak alur "uji di awcms-mini dulu, lalu port", dicabut oleh [ADR-0055](docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — apa yang **sudah ada di kode** saat ini vs gap yang tersisa.
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — **state proyek & titik-lanjut** (baca lebih dulu saat melanjutkan pekerjaan besar): model tata kelola, inventori ringkas, backlog, jebakan penting.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — proses kontribusi & Definition of Done.
- [`SECURITY.md`](SECURITY.md) — kebijakan keamanan & pelaporan kerentanan.

## Skill & subagent (Claude Code)

Repo ini dilengkapi playbook pengembangan berbasis agent, diadaptasi dari [awcms-mini](https://github.com/ahliweb/awcms-mini):

- [`.claude/skills/`](.claude/skills/README.md) — 55 skill tingkat-proyek yang meng-encode standar `docs/awcms/` (scaffold modul, migration, endpoint, ABAC guard, audit log, testing, security review, deploy, dst.). Dipanggil otomatis oleh model atau manual via `/<nama-skill>`.
- [`.claude/agents/`](.claude/skills/README.md#subagents-claudeagents) — subagent `awcms-coder` (implementasi issue end-to-end), `awcms-reviewer` (review PR read-only), `awcms-security-auditor` (audit keamanan read-only).

Konsistensi skill kini **digerbangi CI**: `bun run skills:check` ada di rantai `bun run check` ([ADR-0062](docs/adr/0062-skills-are-gated-against-the-code-they-describe.md)), dan gerbangnya dipersempit [ADR-0068](docs/adr/0068-family-standards-posture-editions-and-recorded-divergences.md) sehingga klaim aspirational wajib berada di blok bertanda — path repo arsip ditulis eksplisit (`awcms-mini:src/…`), bukan seolah path repo ini. `awcms-mini`/`awcms-micro` adalah **arsip** ([ADR-0055](docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md)) — bukan lagi "repo acuan"; skill yang badannya masih spesifikasi mini/micro membawa banner statusnya sendiri. Untuk skill yang menargetkan modul ERP/integrasi bisnis vertikal, terapkan langsung di `src/modules/` template ini saat membangun modul itu ([ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), men-supersede ADR-0022); nomor issue `#NNN` di badan skill warisan merujuk epik repo arsip sebagai contoh, bukan tracker repo ini.

## Mulai dari sini

Skeleton Astro + Bun + migration runner dan dua puluh satu modul — fondasi (`tenant-admin`, `identity-access`, `profile-identity`, `logging`, `module-management`, `sync-storage`, `workflow-approval`, `reporting`, `email`, `domain-event-runtime`), website/konten (`theming`, `media-library`, `blog-content`, `tenant-domain`, `visitor-analytics`, `data-lifecycle`, `seo-distribution`, `form-drafts`, `site-search`, `comments`), plus `idn-admin-regions` — **sudah ada** (lihat [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) untuk state kode terkini dan gap yang tersisa). Untuk melanjutkan pengembangan fondasi: mulai dari `awcms-implement-issue`/`awcms-new-module`, lengkapi RBAC/ABAC + Module Management pada modul baru. Modul domain ERP kini dikerjakan langsung di `src/modules/` template ini ([ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)), bukan di repo turunan terpisah.
