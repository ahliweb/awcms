---
"awcms": patch
---

docs: tiga celah alur ditutup — analisis privasi, Definition of Ready, review pasca-rilis

Ketiganya ditulis sebagai celah di dokumen alur satu putaran lalu. Ini yang
menutupnya, dan masing-masing dibentuk supaya tidak menjadi upacara.

ANALISIS PRIVASI (langkah 3) — `docs/awcms/privacy-analysis.md`. Ia menyatakan
data pribadi apa yang dipegang TEMPLATE ini, diturunkan dari skema nyata, dan
untuk setiap klaim menunjuk ke tempat yang DIGERBANGI alih-alih mengulanginya.
Ia sengaja TIDAK menyalin angka retensi per tabel: salinan itu basi pada hari
pertama seseorang mengubah deskriptornya, dan angka basi di dokumen privasi
lebih berbahaya daripada tidak ada angka.

Dua hal yang membuatnya jujur. Pertama, ia menyatakan apa yang HANYA BISA
DIJAWAB OPERATOR — dasar hukum, DPO, perjanjian pemroses, transfer
lintas-yurisdiksi — alih-alih berpura-pura menjawabnya; template yang
berpura-pura memberi operator rasa aman yang tidak dibelinya apa pun. Kedua, ia
mencatat celah nyata yang tersisa: **tidak ada alur ekspor atau penghapusan per
subjek data**. Operator yang tunduk pada rezim yang menuntutnya harus
membangunnya, dan mengetahuinya di awal jauh lebih murah daripada menemukannya
saat permintaan pertama datang.

DEFINITION OF READY (langkah 9) — `docs/awcms/templates/definition-of-ready.md`.
Pertanyaan PERTAMANYA adalah "apakah policy mengizinkan setiap pembacaan dan
penulisan yang rencana ini butuhkan", dan ia ada di urutan pertama karena repo
ini membayarnya dua kali: ADR-0087 dan ADR-0088 sama-sama menulis rencana yang
mengasumsikan pembacaan lintas-tenant yang FORCE RLS larang, dan keduanya baru
ketahuan saat implementasi. Cara memverifikasinya ditulis di sebelahnya:
jalankan query-nya sebagai `awcms_app` di konteks tenant nyata — nol baris
adalah jawaban, bukan kegagalan setup.

Daftar itu juga menyatakan dua hal yang BUKAN bagiannya: estimasi, dan desain
lengkap. Langkah 9 menanyakan apakah rencananya bisa dikerjakan, bukan menuntut
jawaban akhir untuk pertanyaan yang paling murah dijawab dengan menulis kode.

REVIEW PASCA-RILIS (langkah 18) — `docs/awcms/post-release-reviews.md` plus
templatnya, dan satu bagian baru di `release-process.md` yang menyebut kapan ia
ditulis. Ia register KEDUA, dan pembedaannya disengaja: PROJECT_STATE §4 terikat
putaran kerja dan mencatat keputusan; ini terikat rilis dan mencatat apa yang
terjadi ketika rilis itu bertemu produksi.

RILIS YANG MULUS TETAP MENDAPAT ENTRI. Register yang hanya memuat insiden
mengajarkan pembacanya bahwa rilis biasanya bermasalah, dan menghapus
satu-satunya garis dasar yang membuat rilis buruk terlihat buruk.

Satu baris templatnya menanggung beban khusus di repo ini: "yang pertama kali
terlihat di produksi dan TIDAK terlihat di CI". Di situlah harga keputusan
ADR-0083 — tidak ada staging — dibayar, dan mengumpulkannya rilis demi rilis
adalah satu-satunya cara mengetahui apakah harganya masih pantas. Registernya
mendarat KOSONG dan mengatakannya; mengisinya mundur dari ingatan akan menjadi
kebalikan dari gunanya.

Tabel status di dokumen alur kini menandai 3, 9, dan 18 sebagai ditutup, dan
tetap membedakan CELAH dari KEPUTUSAN (13 dan 14).
