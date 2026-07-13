# Module proposal template

> **Status (2026-07-14):** Repo `awcms` baru pada tahap fondasi ulang (lihat
> [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — belum
> ada modul ERP yang diimplementasikan. Template ini adalah proses admission
> modul yang berlaku begitu modul mulai diusulkan/di-scaffold, diadaptasi
> dari base [awcms-mini](https://github.com/ahliweb/awcms-mini).

Lightweight — bukan RFC panjang. Isi di body issue GitHub sebelum sebuah
modul **System** atau **Official Optional Module** baru mulai di-scaffold di
repo ini. Baca dulu dokumen governance admission modul (rencana:
`docs/awcms/21_module_admission_governance.md` — kategori, pohon keputusan
§3, kriteria admission §4) sebelum mengisi.

Untuk kebutuhan spesifik satu vertikal bisnis (mis. aturan pajak satu
industri, integrasi marketplace tertentu) — pertimbangkan dulu apakah itu
benar-benar generik lintas modul ERP (finance/inventory/procurement/
manufacturing/HR) atau spesifik satu domain; bila spesifik, tetap masuk
sebagai modul domain ERP di `src/modules/` (bukan "aplikasi turunan" seperti
di model awcms-mini — repo ini adalah platform ERP tunggal, bukan base untuk
banyak aplikasi turunan), tapi jelaskan cakupannya di §3 di bawah.

---

## 1. Nama & key modul yang diusulkan

- Nama:
- `key` (`snake_case`):
- Kategori yang diusulkan (**System** / **Official Optional Module** /
  **modul domain ERP** / **External Integration** — bila ragu, isi
  "Tidak yakin" dan jelaskan di §2 di bawah):

## 2. Masalah / kebutuhan

Apa yang tidak bisa dilakukan hari ini tanpa modul ini? Untuk siapa (semua
modul ERP, atau modul/proses bisnis tertentu — mis. hanya alur procurement,
hanya rekonsiliasi finance)?

## 3. Cakupan & generalitas

Bila modul ini diusulkan sebagai **System**/**Official Optional Module**
(dipakai lintas banyak modul domain ERP): buktikan modul ini generik lintas
domain bisnis, bukan spesifik satu vertikal. Bila modul ini adalah **modul
domain ERP** (mis. finance, inventory): jelaskan batas tanggung jawabnya
terhadap modul domain ERP lain yang sudah/akan ada, supaya tidak tumpang
tindih.

## 4. Dependency

- Lifecycle dependency (`ModuleDescriptor.dependencies`, wajib berupa modul
  yang HARUS aktif duluan):
- Capability dependency (`ModuleDescriptor.capabilities.consumes`, tandai
  `required` atau `optional` per entri):

## 5. Kompatibilitas offline/LAN vs full-online-only

- Kelas kompatibilitas yang diusulkan (`offline-lan-safe` /
  `full-online-only`):
- Bila `full-online-only`: bagaimana profil `offline-lan` tetap 100%
  fungsional saat fitur ini off? (mis. transaksi finance/inventory tetap bisa
  dicatat lokal, sinkronisasi ke provider/pusat tertunda sampai online)

## 6. Provider eksternal (bila ada)

Bila modul ini membungkus provider eksternal (payment gateway, marketplace,
sistem pajak/Coretax, logistik, atau kategori External Integration lain),
lihat dan lampirkan hasil
[`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
§Provider eksternal / data governance.

## 7. Security & data governance

Ringkas: data apa yang disentuh (termasuk PII, data finansial/keuangan
sensitif, dokumen HR/payroll), siapa yang boleh akses (ABAC awal), dan aksi
high-risk apa yang perlu audit log (mis. approval transaksi, perubahan harga
pokok, disbursement pembayaran).

### Dampak finansial & sensitivitas data (khusus modul ERP)

- Apakah modul ini menyentuh data finansial (jurnal, saldo, harga pokok,
  payroll)? Bila ya, mekanisme apa yang mencegah perubahan tanpa jejak audit
  (append-only ledger, approval berjenjang)?
- Apakah modul ini bisa memicu kewajiban pajak/pelaporan (mis. faktur pajak,
  Coretax)? Siapa yang bertanggung jawab memvalidasi kepatuhan sebelum
  go-live?
- Klasifikasi sensitivitas data (publik/internal/rahasia/sangat rahasia) dan
  siapa yang berwenang mengubah klasifikasi ini pasca-merge.

## 8. Ownership

Siapa yang akan memelihara modul ini pasca-merge (mengisi
`ModuleDescriptor.maintainers` bila tim sudah lebih dari satu maintainer;
default `.github/CODEOWNERS` bila belum)?

## 9. Rencana deprecation (bila relevan)

Apakah modul ini menggantikan modul/fitur lain yang ada? Bila ya, lihat
dokumen governance admission modul §4.4/§8 untuk pola deprecation notice.

## 10. Alternatif yang dipertimbangkan

Kenapa tidak dilakukan sebagai bagian dari modul yang sudah ada?

---

Setelah issue ini didiskusikan dan disetujui maintainer, lanjutkan ke
[`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
sebagai checklist review PR, dan tulis ADR terpisah bila keputusannya
mengikat lintas dokumen (lihat `AGENTS.md` §Perubahan standar).
