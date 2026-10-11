🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0136-configurable-payroll-segregation-of-duties-mode.md)

<!-- i18n-source-hash: sha256:67be47914deb1fbe83fc8a6ce2a3a5f294a37b0a52a8c7a7b53ec71e1a67142c -->

# ADR-0136 — Pemisahan tugas payroll dapat dikonfigurasi per tenant (ketat secara default, dapat dilonggarkan ke siapkan ≠ setujui)

- **Status:** Diterima
- **Tanggal:** 2026-10-12
- **Pengambil keputusan:** ahliweb
- **Mengubah:** [ADR-0132](0132-hr-payroll-module-family-admission.id.md) (pernyataan bahwa aturan SoD per-instance di database "tidak bisa dikonfigurasi hilang", dan status "diusulkan, belum diputuskan" untuk matriks peran) — amandemen, bukan pengganti; semua isi ADR-0132 yang tidak disebut di sini tetap berlaku
- **Terkait:** Issue #954; Issue implementasi #957 (ADR ini tidak membangun apa pun); keputusan pemilik DoR hilir `ahliweb/awcms-one` O7, dijawab 10 Okt 2026 ([`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md)); [ADR-0031](0031-segregation-of-duties-conflict-enforcement.id.md) (deskriptor aturan SoD, penegakan saat penugasan dan saat aksi, pengecualian); [ADR-0058](0058-unenforced-permissions-disposition.id.md) §E (step-up bersyarat); [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.id.md) §7.5 (matriks dan daftar tes), §11.1, §12, §16

## Konteks

ADR-0132 menerima `hr_payroll` sebagai "diterima, belum bisa dibangun" dan menetapkan tiga hal tentang pemisahan tugas: hitung, setujui, finalisasi, bayar, dan reverse adalah izin terpisah; aturan per-instance berada di database (penyetuju berbeda dari penghitung, pembayar berbeda dari keduanya) dan "tidak bisa dikonfigurasi hilang"; dan matriks peran default **diusulkan**, dengan keputusan pemilik O7 masih terbuka. Bagian 7.5 paket mencatat jawaban pemilik 10 Okt 2026 tetapi meninggalkan dua hal belum diputuskan dan menyatakan teks ADR yang lebih ketat yang berlaku sampai amandemen diterima.

Jawaban pemilik (**O7, mengikat**): pemisahan tugas **dapat dikonfigurasi per tenant**; **default hitung ≠ setujui ≠ bayar**; tenant **boleh melonggarkannya menjadi siapkan ≠ setujui**; **pelonggaran itu diaudit**.

Jawaban itu bertentangan dengan "tidak bisa dikonfigurasi hilang" milik ADR-0132, dan menyisakan sub-pertanyaan **O7a**: pasangan mana persisnya yang dilonggarkan "siapkan ≠ setujui". Ia juga tidak menyatakan siapa yang boleh mengubah pengaturannya. Motivasinya nyata: salon atau klinik dengan dua staf administrasi tidak bisa menyediakan tiga orang berbeda untuk setiap run, dan aturan yang tak mungkin dipenuhi akan disiasati (login bersama), yang lebih buruk daripada aturan longgar yang eksplisit dan diaudit.

## Keputusan

### 1. Mode

Pengaturan per tenant `payroll_sod_mode` ∈ {`strict` (default), `relaxed`} pada pengaturan modul `hr_payroll`. Setiap run mencatat mode yang berlaku saat dihitung (`sod_mode`), immutable setelah `calculate`; mengubah pengaturan tidak pernah mengubah run yang sedang berjalan.

### 2. O7a: pasangan mana yang dilonggarkan (diputuskan)

Pada mode `relaxed`, **tugas penyiap — Hitung (C), Finalisasi (F), Bayar (P) — boleh dipegang satu orang; penyetuju (A) tetap harus orang berbeda dari yang menghitung dan dari yang membayar.** Tepat tiga pasangan yang dilonggarkan: C × P, C × F, F × P. Pasangan yang tidak pernah dilonggarkan, di kedua mode: C × A, A × P, K × A (ubah kompensasi dan setujui run), U × A (terbitkan aturan dan setujui run), R × P (reverse dan bayar), dan pasangan izin konfigurasi di §3. A × F tetap boleh di kedua mode (F membekukan apa yang disetujui A). Jumlah orang: mode ketat butuh tiga orang berbeda per run; mode longgar dua.

Opsi yang dipertimbangkan:

| Opsi                                                                                                              | Kelebihan                                                                                                                                                                                                                           | Kekurangan                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Longgarkan C × P, C × F, F × P; penyetuju tetap berbeda dari penghitung dan pembayar (dipilih)**             | Pembacaan harfiah "siapkan ≠ setujui"; dua orang cukup; penyetuju menjadi pemeriksa independen atas angka dan uang yang keluar; dua CHECK database tetap tanpa syarat, sehingga pengaturan yang diaudit hanya melepas yang dimaksud | Penyiap yang tidak jujur atau diretas dapat menghitung, memfinalisasi, dan membayar sendiri bila penyetuju tertipu; pemeriksaan penyetuju adalah satu-satunya kendali atas run                    |
| B. Longgarkan hanya C × A (penyetuju boleh menghitung atau membayar)                                              | Fleksibilitas jumlah orang terkecil di atas kertas                                                                                                                                                                                  | Menghapus kendali atas uang yang keluar: yang menyetujui juga bisa membayar, pasangan fraud setujui-dan-bayar klasik; bertentangan dengan "siapkan ≠ setujui" pemilik (penyetuju menjadi penyiap) |
| C. Longgarkan hanya C × P, F tetap berbeda dari C dan P                                                           | Lebih sempit daripada A; penyiap tidak bisa membekukan angkanya sendiri                                                                                                                                                             | Jumlah orang sama dengan A (A × F boleh, sehingga penyetuju memfinalisasi), jadi gesekan tambahan nyaris tak berguna; lebih banyak aturan bersyarat untuk diuji dan dijelaskan                    |
| D. Tidak melonggarkan apa pun; wajibkan orang ketiga atau pengecualian C × P berbatas waktu (ADR-0132 apa adanya) | Terkuat di atas kertas                                                                                                                                                                                                              | Bertentangan dengan jawaban pemilik yang mengikat; tenant kecil menyiasatinya dengan login bersama, yang menghancurkan atribusi; jalur pengecualian toh mati karena CHECK per-instance menolaknya |

Keamanan: A dan B berbeda tajam pada independensi penyetuju, dan B ditolak atas dasar itu. A mempertahankan dua CHECK database tanpa syarat (`approved_by <> calculated_by`, `approved_by <> paid_by`) yang tidak bisa dilepas pengaturan apa pun. Operabilitas tenant kecil: A dan C memenuhi kebutuhan dua orang, D tidak. Auditabilitas: pada A seluruh perbedaan antar-mode adalah satu nilai bercap (`sod_mode`) pada tiap run ditambah satu perubahan pengaturan yang diaudit, sehingga peninjau bisa tahu dari run saja aturan mana yang berlaku. A dipilih: aturan paling sederhana yang menghormati kata-kata pemilik.

### 3. Izin yang tidak dipegang penyiap maupun penyetuju

Mengubah mode adalah izin **`hr_payroll.sod_policy.configure`** (resource `sod_policy`, aksi `configure` yang sudah ada, berisiko tinggi; `read` terpisah). Aturan SoD (ADR-0031), `critical`, tanpa pengecualian, melarang satu orang memegangnya bersama C, A, F, atau P. Penyiap tidak boleh bisa melonggarkan pemeriksaan yang mengikatnya, dan penyetuju tidak boleh bisa menentukan cakupan pemeriksaan atas keputusannya sendiri. Ia dipegang administrator tenant yang tidak mengerjakan tugas payroll. Tenant payroll dua orang karenanya butuh principal ketiga **hanya untuk konfigurasi, bukan per run**; tenant tanpa itu tetap ketat. Dukungan platform tidak memegangnya atas nama tenant.

Mengubah mode memerlukan `Idempotency-Key`, kode alasan, step-up bersyarat (ADR-0058 §E) saat **melonggarkan** (mengetatkan diaudit dan idempoten tetapi tidak menuntut step-up), dan menulis baris audit berseverity `critical` dengan aktor serta mode sebelum/sesudah tanpa teks bebas. Setiap baris audit run yang dihitung pada mode longgar memuat `sodMode: "relaxed"`.

### 4. Aturan mana yang CHECK database dan mana yang tingkat peran

Tanpa syarat di kedua mode, sebagai CHECK **dan** aturan tingkat peran: A ≠ C dan A ≠ P. Bersyarat pada `sod_mode = 'strict'` milik run: `finalized_by <> calculated_by` dan `paid_by` berbeda dari `calculated_by` dan `finalized_by`. Deskriptor aturan SoD adalah data statis hanya-kode (ADR-0031) dan tidak bisa membaca pengaturan tenant, sehingga C × P, C × F, dan F × P **hanya ditegakkan per-instance**, bukan sebagai aturan tingkat peran: bila tidak, mode longgar tak akan pernah bisa menugaskan C dan P ke satu orang. Biayanya dinyatakan: pada mode ketat orang yang memegang C dan P ditolak saat aksi kedua dilakukan, bukan saat peran ditugaskan. Pengecualian C × P berbatas waktu pada matriks usulan ADR-0132 **dicabut**: CHECK per-instance akan menolaknya, dan melonggarkan tenant adalah jalur yang sah.

### 5. Amandemen ADR-0132

Kalimat "aturan per-instance database tidak bisa dikonfigurasi hilang" menjadi: **aturan A ≠ C dan A ≠ P tidak bisa dikonfigurasi hilang**; aturan C/F/P di antara mereka sendiri hanya dilepas oleh mode `relaxed` yang diaudit, dicap pada tiap run. Matriks peran tidak lagi "diusulkan" melainkan yang ada di bagian 7.5 paket. Segala hal lain di ADR-0132 tetap berlaku.

### 6. Matriks uji

Tes yang diwajibkan (ketat, longgar, peralihan mode, izin, idempotency, step-up, isolasi, kredensial mesin) adalah 22 baris SOD1–SOD22 pada bagian 7.5 paket, dengan skenario penerimaan S9 dan S9a di bagian 12. Itu adalah persyaratan bagi issue implementasi.

## Konsekuensi

- **Tidak dibangun.** ADR ini tidak membuat migration, path OpenAPI, channel AsyncAPI, seed izin, atau kode. Pengaturan, kolom `sod_mode`, CHECK, izin, dan aturan SoD diimplementasikan di Issue #957; sampai saat itu `hr_payroll` tetap diterima dan digerbangi, dan tes SOD1–SOD22 belum ada.
- Gerbang fase 3 ADR-0132 kehilangan butir "ADR amandemen untuk O7"; butir gerbang lain (enkripsi-saat-diam rekening pembayaran, tinjauan keamanan, tinjauan hukum atas kontrol versi-aturan mesin, gladi restore) tidak berubah.
- Tenant kecil mendapat jalur dua orang tanpa login bersama, dan pelemahannya terlihat: baris audit kritis, mode bercap pada tiap run, izin tersendiri.
- Tenant yang ingin payroll dengan kurang dari dua orang payroll ditambah satu administrator tidak bisa memakai mode longgar; ia tetap ketat atau memakai proses buatan konsumen di luar modul ini. Itu disengaja.
- **Keterbatasan tersisa.** Penyetuju adalah satu-satunya kendali independen pada mode longgar; kolusi antara penyiap dan penyetuju berada di luar yang bisa dicegah SoD, dan hal yang sama berlaku pada mode ketat antara dua dari tiga orang. Rekonsiliasi (bagian 14 paket) dan jejak audit adalah kendali kompensasinya.

## Alternatif yang ditolak

- Opsi B, C, dan D di atas.
- **Mode sebagai pilihan per-run.** Penyiap yang akan memilihnya. Pengaturan per tenant di balik izinnya sendiri adalah kata-kata pemilik dan menjaga keputusan pada orang yang tidak mengerjakan tugas payroll.
- **Editor aturan per-tenant bebas.** Aturan SoD adalah data statis hanya-kode (ADR-0031); ekspresi yang dapat diedit tenant menaruh kendali payroll di data buatan tenant. Dua mode tetap cukup untuk jawaban pemilik.
- **Mengizinkan izin pengaturan mode dipegang bersama tugas tetapi mewajibkan penyetuju kedua untuk perubahannya.** Itu butuh mekanisme perubahan dua-orang umum untuk pengaturan yang belum ada; izin yang tidak dipegang kedua sisi mencapai maksud pemilik dengan mekanisme yang sudah ada.
