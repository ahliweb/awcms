🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](research-ai-assisted-design-evidence-2026-11-28.md)

<!-- i18n-source-hash: sha256:69dc3c1bbf34c793e09c6ce787a78fb203ec0d73e79ca0bcfe848518d80e652a -->

# Bukti desain dan spesifikasi berbantuan AI — admin SISTEM

- Version: 0.2.0
- Date: 2026-11-28
- Status: usulan riset, bukan perubahan normatif maupun implementasi
- Related issue: #1532
- Snapshot bukti: `main` pada commit `164d49aecbba` (2026-11-28).
- Document changeset: teks usulan tetap berlabel `proposed`; rujukan diperiksa ulang saat pengambilalihan, pernyataan vendor dikurangi menjadi klaim sendiri, rujukan yang belum terverifikasi ditandai.

## Metode dan bukti riset

Tinjauan cepat atas sumber publik, bukan tinjauan sistematis maupun uji produk. Riset ini dipicu oleh uraian publik produk komersial perencanaan dan desain berbantuan AI. Hanya konsep fungsional umum dan standar terbuka yang dipakai; pernyataan vendor adalah klaim sendiri, bukan bukti efektivitas.

- [NgodingPakeAI](https://ngodingpakeai.com/) (klaim sendiri vendor): saat pengambilalihan halaman depan menampilkan empat label fitur tanpa uraian, dan fitur desain bertanda segera hadir.
- [Catatan rilis DesainPakeAI](https://desainpakeai.com/updates) (klaim sendiri vendor): saat pengambilalihan halaman memuat sepuluh entri bertanggal antara 2026-08-30 dan 2026-09-23. Isi klaim entri tentang umpan balik kanvas kontekstual tidak diverifikasi saat pengambilalihan.
- [Cui dkk.](https://doi.org/10.1287/mnsc.2025.00535): eksperimen lapangan produktivitas pengembang dengan asisten AI. **Belum diverifikasi saat pengambilalihan** (halaman penerbit menolak akses). Tahun terbit, jumlah peserta, dan besaran efek tidak ditulis di sini sebagai fakta.
- [METR 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/): studi acak dengan 16 pengembang berpengalaman atas 246 issue, waktu penyelesaian 19% lebih lama; halaman menandai hasilnya tidak lagi mutakhir. [Pembaruan 2026](https://metr.org/blog/2026-02-24-uplift-update/) menguraikan perubahan desain studi dan efek seleksi. Bahwa hasilnya berbeda dan tidak boleh digabung atau dijadikan janji penghematan adalah simpulan dokumen ini, bukan kutipan.
- [Perry dkk.](https://arxiv.org/abs/2211.03622): dalam studi terbatas, peserta lebih cenderung percaya kodenya aman; dibaca sebagai sinyal risiko keamanan dan terlalu percaya diri.
- [ISO/IEC/IEEE 12207](https://www.iso.org/standard/90219.html) (proses siklus hidup perangkat lunak) dan [ISO 9241-210](https://www.iso.org/standard/77520.html) (desain berpusat pada manusia): **belum diverifikasi saat pengambilalihan** (halaman katalog menolak akses otomatis). Tahun edisi tidak ditulis di sini.
- [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/): Final Community Group Report 2025-10-28, bukan W3C Recommendation. [Stitch DESIGN.md](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/): pengumuman bertanggal 2026-04-21 yang menguraikan draf spesifikasi. Keduanya rujukan interoperabilitas, bukan alat wajib.

## Batas dan validasi yang diusulkan

Catatan ini mencakup admin SISTEM dan primitif reusable hulu; admin publik dan USER milik `awcms-astro` (lihat `AGENTS.md`). Repo ini tidak punya staging sendiri ([ADR-0083](adr/0083-this-template-deploys-to-one-environment.id.md)); UAT milik repo konsumen.

Diusulkan: inventarisasi form, komponen, tema, dan kontrak admin sistem saat ini. Sebuah form mutasi sintetis single-flight harus memetakan state layar ke operasi, RBAC/ABAC/RLS, dan audit; uji aktor tak berwenang dan isolasi tenant, perilaku keyboard dan fokus, serta tangkapan layar deterministik. Tidak ada perubahan sesi, kebijakan basis data, atau UI publik; tanpa dependensi baru.

## Kontrak bukti (usulan)

- Langkah 2 dan 4 [alur pengembangan](awcms/alur-pengembangan.id.md): kebutuhan dan kriteria penerimaan, ID layar, konteks tinjauan, dan prototipe sintetis.
- Langkah 5–8: data, izin, dan operasi eksplisit, serta mock yang dihasilkan dari kontrak bila berlaku.
- Gerbang 9: deteksi tautan yang hilang atau bertentangan; koreksi kembali ke spesifikasi asalnya.
- Langkah 11: uji per slice hanya setelah persetujuan yang berlaku.
- Langkah 12: baseline visual deterministik serta pemeriksaan manual dan otomatis [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (W3C Recommendation, 2024-12-12); otomasi saja tidak membuktikan aksesibilitas.
- Catat fakta teramati, disetujui, disimpulkan, tidak diketahui, dan diusulkan secara terpisah; pin commit sumber sebenarnya sebelum pilot. Bila UI tidak ada, tandai N/A.
- Pakai artefak kanonis yang ada, jangan menduplikasinya. Ukur waktu termasuk tinjauan dan pengerjaan ulang, kebocoran cacat, keberhasilan tugas, dan biaya terhadap baseline sepadan. Tanpa uji, UAT, atau CI karangan.

## Keamanan dan lisensi

Adopsi mandiri hanya konsep. Tidak menyalin aset atau sumber proprietari; tidak mengirim data rahasia ke penyedia yang belum disetujui. Pakai fixture sintetis, hak akses minimum, redaksi, dan tinjauan lisensi. [NIST SSDF](https://csrc.nist.gov/projects/ssdf/publications): versi 1.1 final (2022), versi 1.2 initial public draft (2025-12-17). [UU PDP](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) dan [UU Hak Cipta](https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014) berlaku sebagaimana relevan; teks pasal UU PDP tidak diverifikasi saat pengambilalihan. Tidak ada klaim sertifikasi kepatuhan atau hasil kinerja.

## Keputusan berikutnya

Issue #1532 memegang inspeksi lebih dalam (ADR, dokumen, kode sebenarnya, CI, dan tumpang tindih), usulan terbatas, dan keputusan peninjau. Catatan ini tidak mengizinkan implementasi, dependensi, rilis, atau keputusan gerbang.

## Koordinasi siklus hidup lewat GitHub Projects (usulan)

Arah yang diusulkan: mengoordinasikan langkah alur pengembangan yang berlaku lewat GitHub Projects (v2), terintegrasi dengan manajemen proyek yang ada dan bukan papan kedua maupun pengganti otoritas repositori. Pekerjaan yang ada: #1532. Cakupan adalah admin SISTEM; kartu staging atau UAT tidak ditandai selesai secara keliru; catat N/A beserta bukti ADR. Tidak satu pun pemetaan di bawah ini berlaku, dan keanggotaan proyek tidak diperiksa.

- Langkah 1–8: lacak keluaran riset dan spesifikasi, ketergantungan, peninjau, kriteria penerimaan, dan URL bukti; tidak ada issue implementasi sebelum Gerbang 9 yang berlaku. Langkah 9: pelacak gerbang merujuk keputusan tercatat, tidak pernah disimpulkan dari tahap papan.
- Langkah 10–12: satu issue kanonis per unit S/M, relasi parent/sub-issue native dan blocked-by bila didukung, milestone, prioritas, dan assignee dipertahankan; PR merujuk issue dan bukti CI. Langkah 13–15: staging dan UAT hanya bila berlaku, bukti kesiapan rilis dan keputusan. Langkah 16–18: deploy, validasi, pemantauan, dan tindak lanjut dengan bukti rilis atau insiden.
- Pakai proyek dan kolom yang sudah disetujui; usulan pemetaan status: backlog, siap (definition of ready terpenuhi), berjalan (diklaim), menunggu (ketergantungan, tinjauan, atau persetujuan), selesai (hasil terverifikasi), batal (dengan alasan). Langkah siklus hidup adalah kolom terpisah atau metadata issue yang ada, tidak pernah disimpulkan dari status. Penolakan gerbang tetap tercatat walau pelacak ditutup. PR ditutup tanpa merge, issue duplikat atau not-planned, atau bukti yang hilang tidak pernah otomatis ditandai selesai. Pertahankan pemilik, assignee, dan target; jangan mengarang tenggat.
- Perubahan keanggotaan atau kolom proyek: temukan pemilik, nomor, akses, dan ID kolom yang hidup; pakai URL atau node ID issue sebenarnya, penambahan idempoten, diff dry-run, baca ulang, dan rekonsiliasi; pertahankan satu issue kanonis dan bedakan item PR dari hitungan pekerjaan. Tanpa kartu draf bersama atau konteks rahasia. Tinjau izin, hindari penyemaian luas dan konflik dengan otomasi status, jangan pernah memindahkan item melintasi batas visibilitas secara otomatis. Papan hanya untuk koordinasi, bukan otoritas merge atau deploy.

Rujukan: [perencanaan dan pelacakan dengan Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects), [memakai API untuk mengelola Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [ketergantungan issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies), [status issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/learning-about-issues/about-issue-statuses). Keempat halaman dokumentasi GitHub ini tidak dibuka saat pengambilalihan.

## Verifikasi rujukan saat pengambilalihan (2026-11-28)

- Didukung dengan membuka sumbernya: METR 2025 dan pembaruan 2026 (dengan koreksi: 246 issue, bukan tugas), Perry dkk., DTCG 2025.10, pengumuman Stitch, NIST SSDF, WCAG 2.2, serta keberadaan kedua halaman undang-undang Indonesia dan dua halaman vendor (hanya daftar).
- Ditandai belum diverifikasi saat pengambilalihan: Cui dkk. (termasuk semua angkanya), ISO/IEC/IEEE 12207 dan ISO 9241-210 (termasuk tahun edisi), teks pasal UU PDP, dan keempat halaman dokumentasi GitHub.
- Koreksi yang dilakukan: angka Cui dkk. dihapus; METR "tugas" diganti "issue" dan penanda tidak mutakhir ditambahkan; pernyataan fitur vendor dikurangi menjadi yang tampak di halamannya; prefiks blob `AGENTS.md` yang basi diganti SHA commit; istilah program internal diganti dokumen alur pengembangan milik repo ini.
- Tidak ada rujukan yang ditambahkan. Semua butir desain, kontrol, ID, dan pemetaan Projects tetap usulan.

## Changelog

### 2026-11-28 - v0.2.0

- Tinjauan pengambilalihan: verifikasi rujukan, koreksi seperti di atas, cermin berbahasa Indonesia ditambahkan.

### 2026-11-28 - v0.1.0

- Catatan riset awal dan bagian koordinasi GitHub Projects.
