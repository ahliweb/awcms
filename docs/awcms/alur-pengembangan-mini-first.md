# Alur pengembangan: awcms-mini dulu, lalu port ke awcms

> **Status:** kontrak kerja operasional. Wajib dipatuhi setiap agent/kontributor
> yang menambah atau mengubah fitur di repo ini. Melengkapi
> [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md) (rebuild di
> atas fondasi awcms-mini) dan [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (apa
> yang sudah ada di kode).

## 1. Relasi dua repo

AWCMS bukan repo tunggal — ia hidup berpasangan dengan repo standarnya,
**awcms-mini**.

| Aspek         | **awcms-mini** (fondasi/standar)                            | **awcms** (repo ini)                                                                                                                                    |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peran         | _Modular monolith standard_ — laboratorium & sumber standar | **Fondasi + kontrak kesiapan ERP** ber-skop ERP; modul ERP nyata hidup di repo turunan ([ADR-0022](../adr/0022-erp-modules-live-in-extension-repos.md)) |
| Kematangan    | Matang — banyak modul sudah teruji end-to-end               | Tahap fondasi (Sprint 1–2), tumbuh bertahap                                                                                                             |
| Modul di kode | ~23 modul (fondasi + CMS + pendukung)                       | Baru 4: `logging`, `tenant-admin`, `profile-identity`, `identity-access`                                                                                |
| Migrasi SQL   | 76 (`001`–`076`)                                            | 7 (`001`–`007`)                                                                                                                                         |
| Route API     | ~290                                                        | ~16                                                                                                                                                     |
| Prefix DB     | `awcms_mini_…`                                              | `awcms_…`                                                                                                                                               |
| Sifat         | Referensi/standar yang stabil                               | Produk turunan yang mengonsumsi & memperluas standar                                                                                                    |

**Rantai tiga lapis:** `awcms-mini` (standar terbukti) → **`awcms`** (fondasi ber-skop ERP, port bertahap) → repo turunan/ekstensi (modul ERP & vertikal nyata di atas awcms). Repo ini menyediakan fondasi + kontrak kesiapan ERP — **bukan** tempat membangun modul domain ERP itu sendiri (ADR-0022).

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
