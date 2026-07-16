# ADR-0022 — Modul domain ERP hidup di repo ekstensi, bukan di dalam base (amandemen ADR-0001 poin 3)

- **Status:** Accepted
- **Tanggal:** 2026-07-16
- **Pengambil keputusan:** @ahliweb
- **Terkait:** ADR-0001 (di-amend oleh ADR ini pada poin 3 + satu alternatif), ADR-0013 (lapisan ekstensi & batas), ADR-0014 (komposisi modul build-time), ADR-0015 (manifest kompatibilitas), ADR-0020 (kontrak kesiapan ekstensi ERP), `docs/awcms/erp-extension-contracts.md`, `docs/awcms/derived-application-guide.md`, `docs/awcms/21_module_admission_governance.md`, epic #738 `platform-evolution`

## Konteks

ADR-0001 (2026-07-14) memutuskan membangun ulang `awcms` "sebagai platform ERP modular monolith". Poin 3-nya menyatakan modul domain ERP (finance, inventory, procurement, manufacturing, hr-payroll) dan modul integrasi bisnis "dikembangkan sebagai modul di `src/modules/`" repo ini; bagian Alternatif-nya secara eksplisit **menolak** opsi "mengembangkan ERP di repo/base terpisah".

Epic #738 `platform-evolution` (ADR-0013 s/d ADR-0021, semua Accepted, 2026-07-13 dan sesudahnya) menjawab pertanyaan yang belum tergarap saat ADR-0001 ditulis: **bagaimana banyak repo turunan independen menyusun kemampuan base ini tanpa mengedit registry base dan tanpa saling menimpa data.** Jawaban yang diambil epic itu memindahkan posisi modul ERP secara tegas ke luar base:

- **ADR-0013 §1** mendefinisikan enam lapisan ekstensi. Lapisan **ERP Extension** (juga SaaS Control Plane dan Derived Application generik) ditandai _"Hidup di repo base ini? **Tidak pernah**"_. Item/product master, general ledger, AR/AP, valuasi inventory, payroll, dan pajak dicantumkan sebagai isi lapisan itu — di luar base.
- **ADR-0020 / `docs/awcms/erp-extension-contracts.md`** menyatakan langsung: _"Base ini bukan ERP. Tidak ada chart of accounts, jurnal, general ledger, valuasi inventori, sales/purchase order, AR/AP, kas-bank, fixed asset, payroll, atau perhitungan pajak di repository ini — dan tidak akan pernah ada."_ Base hanya menyediakan **kontrak netral** (bentuk data pasif, capability port, skema payload event) yang diimplementasikan/dikonsumsi ekstensi ERP di repo terpisah.
- **ADR-0014/0015** memberi mekanisme konkret agar repo turunan menyusun modulnya sendiri **tanpa** mengedit registry base: `application-registry.ts` milik repo turunan + `extension.manifest.json` + `bun run extension:check`.
- **Bukti kode saat ADR ini ditulis:** `src/modules/` hanya berisi modul fondasi reusable (`identity-access`, `logging`, `profile-identity`, `tenant-admin`, `_shared`). ADR-0016–0021 meng-admit hanya modul _fondasi_ (organization_structure, document_infrastructure, data_exchange, integration_hub, reference_data) — bukan logika bisnis ERP. Tidak ada satu pun modul finance/inventory/procurement/manufacturing/payroll di base.

Dengan kata lain, keputusan de facto repo ini sudah bertentangan dengan huruf ADR-0001 poin 3. Aturan `docs/adr/README.md` §2 melarang menulis ulang ADR Accepted secara diam-diam — perubahan arah harus dicatat lewat ADR baru yang mereferensikan yang lama. ADR ini adalah pencatatan itu.

## Keputusan

Kami memutuskan untuk **meng-amend ADR-0001**:

1. **Poin 3 ADR-0001 diganti** menjadi: modul domain ERP (finance/GL, inventory/warehouse, procurement, manufacturing, hr-payroll) dan modul integrasi bisnis vertikal **tidak dibangun di dalam `src/modules/` base ini**. Mereka hidup di **repo ekstensi/turunan terpisah** pada lapisan **ERP Extension** / **Derived Application** (ADR-0013 §1), disusun lewat komposisi modul build-time (ADR-0014) dan diikat manifest kompatibilitas (ADR-0015). Base hanya menyediakan modul fondasi reusable + kontrak netral kesiapan ERP (ADR-0020).

2. **Alternatif "mengembangkan ERP di repo/base terpisah" pada ADR-0001 — yang dahulu ditolak — kini menjadi arah yang diadopsi**, dengan alasan yang tidak tersedia saat ADR-0001 ditulis: epic #738 menyediakan mekanisme lintas-repo (komposisi build-time, manifest, kontrak port/event berversi) yang menghilangkan "overhead sinkronisasi tanpa manfaat jelas" yang menjadi dasar penolakan awal.

3. **Framing "AWCMS adalah platform ERP" diganti menjadi "AWCMS adalah basis/fondasi platform tempat ERP & solusi bisnis dibangun di atasnya."** AWCMS bukan sebuah ERP; ia adalah base modular monolith reusable + kontrak ekstensi ERP.

Yang **tidak** berubah dari ADR-0001: keputusan tidak mengarsipkan repo (poin 1), seluruh standar teknis fondasi (Bun-only, RLS wajib, ABAC default-deny, offline-first/outbox HMAC, kontrak OpenAPI/AsyncAPI, idempotency, audit — poin 1 & 2), dan disiplin ADR untuk penyimpangan standar (poin 4). ADR-0002…0021 tetap Accepted apa adanya.

Status ADR-0001 ditandai `Accepted (poin 3 & satu alternatif di-amend oleh ADR-0022)`.

## Konsekuensi

- **Positif:** dokumen "pintu depan" (README, canvas induk, indeks ADR) selaras dengan keputusan yang sudah mengikat (ADR-0013/0020) dan dengan kondisi kode nyata; kontributor/aplikasi turunan tidak lagi menerima sinyal bertentangan soal "di mana modul ERP hidup"; batas base vs ekstensi menjadi tunggal dan konsisten.
- **Trade-off:** ERP lintas-repo memikul overhead kontrak berversi (port, event, manifest) dan koordinasi rilis base↔ekstensi — biaya yang kini dinilai sepadan karena mekanismenya sudah ada (ADR-0014/0015), berbeda dari saat ADR-0001 menolaknya.
- **Netral:** ADR-0001 tetap ada sebagai rekaman historis (tidak dihapus, sesuai `docs/adr/README.md` §2); poin 1/2/4-nya masih berlaku penuh.

## Alternatif yang dipertimbangkan

- **Membiarkan ADR-0001 apa adanya dan hanya memperbaiki README/canvas** — ditolak: menyisakan rekaman keputusan pendiri yang secara eksplisit bertentangan dengan ADR-0013/0020, persis jenis drift yang aturan supersede §2 dibuat untuk mencegah.
- **Menulis ulang isi ADR-0001 langsung** — ditolak: melanggar `docs/adr/README.md` §2 (ADR Accepted tidak diedit diam-diam; perubahan dicatat lewat ADR baru).
- **Menandai ADR-0001 `Superseded` seluruhnya** — ditolak: mayoritas ADR-0001 (tidak-diarsipkan, standar teknis fondasi, disiplin ADR) masih berlaku; hanya poin 3 + satu alternatif yang berubah, sehingga "amended" lebih akurat daripada "superseded".
