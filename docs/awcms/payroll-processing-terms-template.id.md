🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](payroll-processing-terms-template.md)

<!-- i18n-source-hash: sha256:db985726e871655cb2d29cf9f14fb1d814a7944c99681bf87fbf92da4eabc8eb -->

# Ketentuan pemrosesan penggajian — templat (pengendali dan operator)

> **STATUS: TEMPLAT, bukan kontrak dan bukan nasihat hukum.** Ini kerangka bagi
> penasihat hukum untuk dijadikan perjanjian, tidak lebih (keputusan pemilik
> K13). Dokumen ini **tidak** memutuskan keputusan pemilik **O5** (peran hukum
> operator per deployment): ia memuat kedua hasil, **varian A** dan **varian B**,
> dan deployment mempertahankan yang dicatat adendumnya. Setiap butir hukum yang
> tidak diyakini penulis ditandai **perlu verifikasi penasihat hukum**; tidak ada
> pasal undang-undang yang dikutip sebagai fakta. Issue #1449, residu DPIA R-11;
> pendamping
> [`dpia-addendum-hr-payroll-template.id.md`](dpia-addendum-hr-payroll-template.id.md)
> dan angka operasional di `payroll-breach-notification-runbook.md` (draf, bagian
> 5).

Tanda `[[...]]` adalah isian kosong. Berkas ini templat: tidak ada yang membacanya
di dalam repositori.

## 0. Varian mana

| Varian | Kapan berlaku                                                                                    | Operator adalah                                    |
| ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **A**  | Tenant menentukan tujuan dan sarana; operator hanya menjalankan platform untuknya.               | Prosesor data penggajian tenant                    |
| **B**  | Operator juga menentukan sebagian tujuan atau sarana data penggajian, atau DPIA menyimpulkannya. | Pengendali bersama, atau peran yang ditemukan DPIA |

Adendum deployment, bagian 1, mencatat mana yang berlaku. Penasihat hukum
memutuskan apakah kasus campuran memerlukan keduanya.

## 1. Para pihak dan pokok perjanjian

- Pengendali: [[badan hukum tenant]] ("Tenant"). Operator: [[badan hukum operator]] ("Operator").
- Pokok: Operator menyediakan modul penggajian AWCMS bagi Tenant. Kategori data
  dan subjek data sesuai adendum, bagian 2 dan 3. Jangka waktu: masa perjanjian
  layanan ditambah masa pada bagian 9.

## 2. Instruksi dan pembatasan tujuan

**Varian A.** Operator memproses data penggajian tenant hanya atas instruksi
tertulis Tenant (perjanjian ini dan pemakaian produk oleh Tenant), untuk tujuan
dalam adendum, dan tidak untuk yang lain: tanpa pembuatan profil, penilaian,
pemasaran, pelatihan AI, atau penjualan. Operator segera memberi tahu Tenant
bila menilai suatu instruksi melanggar hukum (**perlu verifikasi penasihat
hukum** apakah dan bagaimana UU PDP mensyaratkannya).

**Varian B.** Tujuan dan sarana tiap pihak dibagi dalam tabel di adendum, bagian

1. Inti pengaturannya disediakan bagi subjek data (**perlu verifikasi penasihat
   hukum** apakah UU PDP mensyaratkannya dan dalam bentuk apa).

## 3. Akses staf operator (klausul R-11)

Klausul ini membuat bagian 7 adendum mengikat.

1. **Tanpa akses tetap.** Tidak ada personel Operator yang memiliki akses tetap
   ke data penggajian Tenant. Role aplikasi staf Operator, termasuk yang berada
   di tenant platform, tidak membawa izin penggajian untuk Tenant.
2. **Hanya darurat (break-glass).** Akses langsung ke baris penggajian (database,
   pemulihan cadangan, konsol hosting) hanya diizinkan untuk [[tujuan: pemulihan, perbaikan, penanganan insiden]], oleh [[role bernama]], dengan persetujuan
   [[role]] dan orang kedua yang hadir atau meninjau, selama waktu tersingkat yang
   diperlukan.
3. **Tercatat.** Setiap akses demikian dicatat di luar aplikasi: siapa, kapan,
   mengapa, apa yang disentuh (jumlah, tidak pernah nominal atau nomor rekening),
   penyetuju, dan tiketnya. Catatan disimpan [[masa]] dan diperlihatkan kepada
   Tenant bila diminta. Bila deployment tidak punya pencatatan demikian, adendum
   menulis "belum dikonfigurasi" dan klausul ini **tidak** diklaim terpenuhi.
4. **Pemberitahuan.** Tenant diberi tahu [[sebelum / dalam N jam sesudah]] setiap
   akses menurut butir 2 (varian A: karena itu data Tenant; varian B: untuk bagian
   yang dikendalikan Tenant).
5. **Kerahasiaan.** Personel yang mungkin punya akses terikat pernyataan
   kerahasiaan tertulis yang tetap berlaku setelah penugasan berakhir.
6. **Tinjauan.** Daftar role yang punya akses ditinjau [[frekuensi]] dan setelah
   setiap pergantian staf pada role itu.
7. **Yang ditegakkan produk sendiri** (terverifikasi di repositori saat ditulis):
   tabel penggajian hanya diberi hak kepada role permintaan; row-level security
   dipaksa dan berlingkup tenant; izin penggajian berlingkup tenant; pembacaan
   lewat aplikasi meninggalkan baris audit-baca sensitif. Semua itu tidak
   mengikat administrator database, itulah sebabnya butir 2 sampai 4 ada.

## 4. Langkah pengamanan

Operator memelihara langkah dalam
`docs/awcms/20_threat_model_security_architecture.md` dan gerbang kesiapan
deployment (`bun run security:readiness` hijau), termasuk enkripsi ciphertext
rekening pembayaran dengan key ring deployment dan batas data yang menjaga
penggajian di luar laporan, pencarian, cache publik, dan kanal pesan. Operator
tidak melemahkannya tanpa memberi tahu Tenant. Langkah tambahan yang disepakati:
[[daftar atau "tidak ada"]].

## 5. Sub-prosesor

Operator hanya memakai sub-prosesor yang tercantum di adendum, bagian 5.
**Varian A:** ia memberi tahu Tenant [[N hari]] sebelum menambah atau mengganti
satu, dan Tenant dapat berkeberatan [[akibatnya]]; tiap sub-prosesor terikat
kewajiban yang tidak lebih lemah dari ketentuan ini; Operator tetap bertanggung
jawab atasnya (**perlu verifikasi penasihat hukum** persyaratan pastinya menurut
UU PDP).

## 6. Transfer

Data penggajian disimpan dan diakses hanya di [[negara]]. Perubahan apa pun,
termasuk lokasi cadangan dan akses dukungan dari tempat lain, memerlukan
persetujuan tertulis Tenant sebelumnya dan posisi hukum transfer yang tercatat
di adendum, bagian 6 (**perlu verifikasi penasihat hukum**, L-P10).

## 7. Permintaan subjek data

**Varian A.** Tenant menjawab permintaan. Operator meneruskan permintaan yang
diterimanya dalam [[N hari kerja]] tanpa menjawabnya, dan menyediakan data atau
ekstrak audit yang dibutuhkan Tenant, dalam [[N hari kerja]]. Ekspor data subjek
produk bersifat per tenant (ADR-0094) dan menjaga nominal penghasilan tetap di
luar laporan tersimpan.

**Varian B.** Permintaan dijawab sesuai pembagian di adendum, bagian 1; bagian
milik Operator sendiri dijawab Operator.

## 8. Pemberitahuan pelanggaran

Kewajiban dan jam menurut undang-undang berada pada pengendali (runbook, bagian
3, mencatat apa yang dan tidak dinyatakan; **perlu verifikasi penasihat hukum**).
Komitmen operasional Operator, yang ditetapkan klausul ini atau diganti dengan
angka yang disepakati:

| Langkah                                                                          | Komitmen                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Peringatan awal ke Tenant begitu terbukanya data penggajiannya masuk akal        | secepat mungkin, dan bagaimanapun dalam [[jam]]                                                         |
| Pemberitahuan ke Tenant setelah paparan dikonfirmasi atau tak dapat disingkirkan | dalam [[jam; runbook mengusulkan 24 jam sejak konfirmasi]]                                              |
| Isi pemberitahuan dan bukti yang diberikan                                       | seperti di runbook, bagian 11.1 dan bagian 8                                                            |
| Kontak di tiap sisi                                                              | [[role dan saluran bernama]]                                                                            |
| Siapa mengirim pemberitahuan ke subjek data dan otoritas                         | **A:** Tenant, kecuali ia menginstruksikan Operator secara tertulis. **B:** tiap pihak untuk bagiannya. |
| Biaya pemberitahuan                                                              | [[pembagian]]                                                                                           |

Runbook adalah draf sampai pengendali mengadopsinya; mengadopsinya adalah syarat
go-live (adendum, bagian 11).

## 9. Pengembalian dan penghapusan

Di akhir layanan, atau atas permintaan tertulis Tenant, Operator [[mengembalikan / menghapus]] data penggajian Tenant dalam [[jangka]], tunduk pada retensi yang
dicatat adendum (bagian 4) dan penahanan hukum apa pun. Cadangan kedaluwarsa
dalam [[jangka]]. Operator menegaskannya secara tertulis. **Perlu verifikasi
penasihat hukum** bagaimana kewajiban retensi hukum Tenant berinteraksi dengan
penghapusan (L-P7, L-P8).

## 10. Audit dan informasi

Operator menyediakan apa yang diperlukan untuk menunjukkan kepatuhan pada
ketentuan ini dan mengizinkan audit yang wajar oleh Tenant atau auditor
tunjukannya: [[frekuensi, pemberitahuan, biaya, lingkup]]. Bukti yang dapat
dihasilkan produk (jejak audit, audit-baca sensitif, keluaran gerbang kesiapan)
ditawarkan lebih dulu.

## 11. Tanggung jawab, jangka waktu, hukum yang berlaku

[[untuk penasihat hukum: tidak disusun di sini]]

## 12. Pengesahan (keputusan pemilik K13)

| Pihak                    | Penandatangan (nama, kapasitas) | Tanggal        |
| ------------------------ | ------------------------------- | -------------- |
| Pengendali               | [[...]]                         | [[YYYY-MM-DD]] |
| Operator                 | [[...]]                         | [[YYYY-MM-DD]] |
| Tinjauan penasihat hukum | [[...]]                         | [[YYYY-MM-DD]] |

Templat ini bukan nasihat hukum. Pernyataan yang tidak dapat dikonfirmasi penulis
dihimpun di sini untuk penasihat hukum: apakah UU PDP mensyaratkan perjanjian
pemrosesan tertulis dan isi minimumnya; kewajiban prosesor menandai instruksi
yang melanggar hukum; syarat sub-prosesor; bentuk pengaturan pengendali bersama;
syarat transfer; interaksi penghapusan dengan retensi menurut undang-undang;
apakah operator punya kewajiban langsung menurut undang-undang untuk memberi
tahu.
