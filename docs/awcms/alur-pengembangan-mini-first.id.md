🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](alur-pengembangan-mini-first.md)

<!-- i18n-source-hash: sha256:0ef14ee9e6c9655cff9aba4369ea05d316100311f32393c46811534d831d23cf -->

# Alur pengembangan: awcms-mini dulu, lalu port ke awcms

> **DIGANTIKAN oleh [`alur-pengembangan.md`](alur-pengembangan.md)** (13 Agustus
> 2026), yang kini dokumen kanonik proses. Berkas ini tinggal sebagai catatan
> sejarah dan tidak mengikat siapa pun.

> **DICABUT PERMANEN ([ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md), 2 Agustus 2026).**
> Penangguhan ADR-0047 (31 Juli 2026) berubah menjadi pencabutan: `awcms-mini`
> dan `awcms-micro` kini **arsip** — boleh dibaca sebagai referensi sejarah,
> tetapi alur mini-first **tidak akan kembali**. Kapabilitas baru masuk lewat
> **ADR admission dan dibangun langsung di repo ini**, dengan penjagaan yang
> didaftar ulang di ADR-0055 §3 (ADR wajib untuk perubahan standar, security
> review tambahan `auth`/`access`/`sync`, `bun run check` penuh, OpenAPI/AsyncAPI
> sinkron, RLS `FORCE`, ABAC default-deny).

> **Status:** catatan sejarah — dokumen ini merekam kontrak kerja mini-first
> sebagaimana dulu berlaku, dan **tidak lagi mengikat siapa pun**. Klaim di
> badan dokumen ("wajib", "tetap berlaku", angka modul/migrasi) adalah potret
> eranya; keadaan kini ada di
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) dan
> [`../PROJECT_STATE.md`](../PROJECT_STATE.md).

## 1. Relasi dua repo

AWCMS bukan repo tunggal — ia hidup berpasangan dengan repo standarnya,
**awcms-mini**.

| Aspek         | **awcms-mini** (fondasi/standar)                            | **awcms** (repo ini)                                                                                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Peran         | _Modular monolith standard_ — laboratorium & sumber standar | **Template ERP/back-office dipakai-langsung** — fondasi + modul domain (ERP, website/e-commerce, konten) hidup langsung di `src/modules/` ([ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)/[ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)) |
| Kematangan    | Matang — banyak modul sudah teruji end-to-end               | Matang untuk fondasi + klaster website/konten; ERP masih tumbuh                                                                                                                                                                                                                                                    |
| Modul di kode | ~23 modul (fondasi + CMS + pendukung)                       | **22 modul** — verifikasi dengan `listModules()`, jangan kutip angka dokumen                                                                                                                                                                                                                                       |
| Migrasi SQL   | 76 (`001`–`076`)                                            | **79** (`001`–`079`)                                                                                                                                                                                                                                                                                               |
| Route API     | ~290                                                        | lihat `openapi/awcms-public-api.openapi.yaml` (bundel deterministik)                                                                                                                                                                                                                                               |
| Prefix DB     | `awcms_mini_…`                                              | `awcms_…`                                                                                                                                                                                                                                                                                                          |
| Sifat         | Referensi/standar yang stabil                               | Template dipakai-langsung — dikembangkan dari basis teknis mini & menyerap klaster website/e-commerce awcms-micro                                                                                                                                                                                                  |

**Keluarga tiga template sejajar (dipakai-langsung):** `awcms-mini` (fondasi **hybrid offline-first**, SaaS-ready — standar terbukti) · `awcms` (template **ERP/back-office** **hybrid online-first**, **superset** yang menyerap klaster website/e-commerce awcms-micro) · `awcms-micro` (template website **full-online** lean) — lihat [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)/[ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md). Modul domain (ERP, website/e-commerce, konten) hidup **langsung di `src/modules/`** template ini — tidak ada repo turunan/ekstensi terpisah. Alur mini-first tetap berlaku: fitur dimatangkan di awcms-mini lalu di-port ke sini; sebagian modul website juga di-port dari awcms-micro.

Semua dokumen di [`docs/awcms/`](README.md) adalah **target/rencana** yang
diadaptasi dari paket dokumen awcms-mini — bukan cermin keadaan kode awcms saat
ini (lihat [`README.md` §Status](README.md)). Klaim "sudah live/tersedia" yang
berasal dari sumber awcms-mini harus dibaca sebagai **target yang mengikat**,
bukan fakta di repo ini.

## 2. Aturan wajib: uji di awcms-mini lebih dulu

**Setiap penambahan/perubahan fitur diimplementasikan dan diuji lebih dulu di
awcms-mini, baru kemudian di-port ke awcms.** Repo ini tidak menjadi tempat
merintis fitur baru dari nol.

Alasannya:

- awcms-mini adalah **standar acuan** — mematangkan pola (kontrak, migration,
  ABAC, audit, idempotency, test) di sana menjaga fondasi tetap teruji sebelum
  masuk ke produk ERP.
- Mengurangi risiko: awcms mewarisi fondasi yang **sudah** lulus uji, bukan
  eksperimen yang belum stabil.
- Menjaga kedua repo tetap selaras pada level pola/standar, sehingga adaptasi
  ERP di sini fokus pada **skop**, bukan menemukan ulang fondasi.

Pengecualian hanya untuk hal yang khas awcms dan tidak punya padanan di
awcms-mini (mis. kontrak khusus ERP) — itu pun didahului ADR bila mengubah
standar dasar (lihat [`GOVERNANCE.md`](../../GOVERNANCE.md)).

## 3. Langkah port awcms-mini → awcms

1. **Selesaikan & uji di awcms-mini** — modul/fitur lengkap dengan migration,
   OpenAPI/AsyncAPI, test berlapis, dan `bun run check` hijau di sana.
2. **Adaptasi skop** — petakan fitur ke skop fondasi/ERP repo ini; buang bagian
   yang khusus produk CMS awcms-mini bila tidak relevan.
3. **Rename identifier** — ganti prefix `awcms_mini_…` menjadi `awcms_…` pada
   nama tabel, env var, dan artefak; jangan tinggalkan sisa penamaan repo acuan
   (dijaga otomatis oleh `bun run check:docs`, pola `awcms[_-]mini_…`).
4. **Sinkronkan kontrak** — perbarui `openapi/`, `asyncapi/`, migration di
   `sql/`, registri modul `src/modules/index.ts`, dan dokumen `docs/awcms/`
   terkait agar cocok dengan kode yang di-port.
5. **Tulis/port test** — pastikan test ikut dibawa dan lulus di repo ini.
6. **Validasi lokal** — `bun run check` hijau sebelum membuka PR.
7. **Family conformance** — bila port menaikkan versi kontrak (module/capability/OpenAPI/AsyncAPI), mengubah versi stack, mengubah semantik kontrol reusable, atau menambah perbedaan sengaja dari mini, perbarui [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) dan pastikan `bun run family:conformance:check` hijau (bagian dari `bun run check`) — lihat [`family-compatibility.md`](family-compatibility.md).
8. **Changeset** — tambahkan bila perilaku berubah (kebijakan SemVer
   [doc 09](09_roadmap_repository_commit.md)).

## 4. Implikasi untuk agent

- Sebelum membangun fitur baru di sini, **cek apakah padanannya sudah ada/teruji
  di awcms-mini**. Bila belum, matangkan di sana dulu.
- Jangan memperlakukan dokumen `docs/awcms/` sebagai bukti kode sudah ada —
  selalu verifikasi ke `src/modules/`, `sql/`, `openapi/`, `asyncapi/`.
- Saat mengutip/menyalin dari awcms-mini, selalu **rename prefix** dan sesuaikan
  skop; `bun run check:docs` akan menolak sisa `awcms_mini_…`.

## 5. Rujukan

- [`../adr/0001-rebuild-on-awcms-foundation-erp-scope.md`](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)
  — keputusan rebuild di atas fondasi awcms-mini.
- [`README.md`](README.md) — paket dokumen teknis (target) & status adaptasi.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — apa yang sudah ada di kode.
- [`../../AGENTS.md`](../../AGENTS.md) — alur kerja wajib setiap task.
