# ADR-0007 — OpenAPI & AsyncAPI sebagai kontrak wajib

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `docs/awcms/05_openapi_asyncapi_detail.md`, `docs/awcms/10_template_kode_coding_standard.md`

## Konteks

Tanpa kontrak eksplisit, API dan event mudah menyimpang antar modul/aplikasi turunan, dan sulit diuji atau diverifikasi konsistensinya. Base perlu satu sumber kebenaran untuk permukaan REST dan event domain.

## Keputusan

Kami memutuskan menjadikan **OpenAPI** kontrak wajib untuk REST (`openapi/`) dan **AsyncAPI** kontrak wajib untuk domain event (`asyncapi/`). Setiap API baru/berubah wajib memperbarui OpenAPI; setiap event baru/berubah wajib memperbarui AsyncAPI. Konsistensi kontrak ↔ registry modul divalidasi otomatis (`api:spec:check`): setiap event yang dideklarasikan `publishes` harus terdaftar sebagai channel AsyncAPI. Envelope response dan katalog error code distandarkan.

## Konsekuensi

- **Positif:** kontrak menjadi sumber kebenaran; drift terdeteksi di CI; contract test dan dokumentasi API konsisten.
- **Trade-off:** kedisiplinan tambahan — perubahan API/event tidak boleh tanpa update kontrak.
- **Netral:** aplikasi turunan menambah path/event domainnya di `openapi/modules/` dan AsyncAPI-nya sendiri.

## Alternatif yang dipertimbangkan

- **Kontrak digenerate dari kode saja** — ditolak untuk tahap desain: kontrak dipakai sebelum kode ada (design-first).
- **Tanpa kontrak event** — ditolak: event antar modul tanpa kontrak rapuh dan sulit diuji.
