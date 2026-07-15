# ADR-0008 — Versioning independen: package, kontrak API/event, module descriptor

- **Status:** Accepted
- **Tanggal:** 2026-07-06
- **Pengambil keputusan:** maintainer
- **Terkait:** `docs/awcms/09_roadmap_repository_commit.md`, `docs/awcms/05_openapi_asyncapi_detail.md`, ADR-0007 (kontrak OpenAPI/AsyncAPI wajib), Issue #451

## Konteks

`package.json` sudah di `0.23.5` (SemVer, Changesets-driven, bump setiap PR yang mengubah perilaku), sementara `openapi/awcms-public-api.openapi.yaml` dan `asyncapi/awcms-domain-events.asyncapi.yaml` masih di `info.version: 0.1.0`, dan seluruh 7 `src/modules/*/module.ts` masih `version: "0.1.0"` dengan `status: "experimental"` — walau modul-modul itu sudah diimplementasikan penuh, ditest, dan diperkuat security hardening (Issue #437). Tanpa kebijakan tertulis, angka-angka ini terlihat basi/konflik tanpa penjelasan.

## Keputusan

Kami memutuskan **tiga skema versi independen**, masing-masing dengan aturan bump sendiri — tidak mekanis disamakan satu sama lain:

1. **`package.json` (SemVer rilis repo)** — sudah benar, tidak berubah. Digerakkan Changesets; bump pada setiap PR yang mengubah perilaku aplikasi (fitur/fix/breaking). Ini adalah versi _rilis_, bukan versi _kontrak_.

2. **`info.version` OpenAPI/AsyncAPI (SemVer kontrak)** — independen dari versi rilis. Bump hanya bila **bentuk kontrak itu sendiri** berubah:
   - **PATCH** — perbaikan deskripsi/dokumentasi kontrak, tanpa perubahan skema.
   - **MINOR** — perubahan aditif backward-compatible (endpoint/event baru, field opsional baru, parameter baru).
   - **MAJOR** — perubahan breaking (field/endpoint dihapus/diganti nama, bentuk respons berubah).

   `1.0.0` menandai kontrak yang **dinyatakan stabil** untuk dikonsumsi produksi — bukan "rilis pertama", tapi "API ini sudah matang dan siap dipakai aplikasi turunan/klien eksternal tanpa disclaimer eksperimental". Seluruh 18 issue backlog base + hardening M9 tuntas adalah titik yang tepat untuk deklarasi itu, sehingga `info.version` dinaikkan **satu kali** dari `0.1.0` ke `1.0.0` sebagai bagian ADR ini (bukan mengikuti `package.json` secara mekanis — PR berikutnya yang menambah field opsional baru cukup bump `1.1.0`, BUKAN ikut lompat ke versi rilis `0.24.0`).

3. **`version`/`status` module descriptor (`src/modules/*/module.ts`)** — independen dari keduanya, mengikuti maturitas modul itu sendiri:
   - `status: "experimental"` — modul baru/scaffold, permukaan API/skema masih bisa berubah signifikan, belum dipakai fitur nyata.
   - `status: "active"` — modul sudah diimplementasikan penuh, punya endpoint/domain logic nyata yang dipakai, ditest, dan sudah melalui security review.
   - `status: "deprecated"` — modul digantikan, dijadwalkan dihapus.

   Ketujuh modul base (`identity_access`, `logging`, `profile_identity`, `reporting`, `sync_storage`, `tenant_admin`, `workflow_approval`) semuanya sudah punya endpoint/domain logic nyata, RLS+ABAC, test, dan lolos audit keamanan Issue #437 — status diubah `experimental` → `active`, versi dinaikkan `0.1.0` → `1.0.0` (deklarasi stabilitas yang sama seperti kontrak). Bump versi modul berikutnya terjadi saat kapabilitas modul itu sendiri berubah nyata, ditentukan oleh siapa pun yang mengirim perubahan tersebut — bukan mengikuti rilis package atau kontrak.

`status` module descriptor murni metadata deskriptif — tidak divalidasi/dikonsumsi runtime mana pun (dicek: tidak ada endpoint yang mengekspos atau menggerbang perilaku berdasarkan field ini) — jadi mengubahnya nol risiko perilaku.

### Enforcement minimal

`scripts/api-spec-check.ts` (`bun run api:spec:check`) kini memvalidasi `info.version` OpenAPI **dan** AsyncAPI harus berbentuk SemVer (`X.Y.Z`) — bukan sekadar "ada", seperti sebelumnya. Ini mencegah versi kontrak kosong/placeholder tanpa memaksa nilai tertentu, sehingga bump kontrak yang sah tidak pernah gagal check ini.

## Konsekuensi

- **Positif:** setiap angka versi (`package.json`, kontrak, modul) punya makna dan aturan bump sendiri yang bisa dijelaskan — tidak ada lagi "kenapa ini masih 0.1.0?" tanpa jawaban. Modul descriptor `active` sekarang jujur mencerminkan maturitas nyata.
- **Trade-off:** kontributor harus tahu skema mana yang di-bump untuk perubahan tertentu (perilaku aplikasi → package; bentuk kontrak → OpenAPI/AsyncAPI; kapabilitas modul → module descriptor) — didokumentasikan di sini agar tidak ambigu.
- **Netral:** aplikasi turunan yang menambah modul domainnya sendiri mengikuti pola yang sama (mulai `0.1.0`/`experimental`, naik ke `active`/`1.0.0` saat matang).

## Alternatif yang dipertimbangkan

- **Samakan semua versi ke `package.json` secara mekanis** — ditolak: memberi sinyal keliru bahwa kontrak/modul berubah setiap kali _apa pun_ di repo berubah, padahal keduanya punya siklus perubahan sendiri (kontrak jarang berubah bentuk; modul jarang berubah scope).
- **Biarkan versi kontrak/modul independen tanpa kebijakan tertulis** — ditolak: itulah kondisi sebelum ADR ini, membingungkan kontributor baru dan konsumen API eksternal (persis masalah yang diangkat Issue #451).
