---
"awcms": patch
---

Bangun ulang graf pengetahuan graphify: `graph.json` kini membawa nama komunitas, dan cakupan `.sql` dipulihkan

Artefak di `graphify-out/` — bukan kode runtime. Tidak ada perubahan perilaku aplikasi, API, skema, atau permission; tingkat `patch` dipakai karena gerbang `changesets:policy:check` menuntut satu tingkat bump eksplisit dan tidak menerima changeset kosong.

Graf terakhir dibangun 29 Juli, 88 commit yang lalu. Rebuild inkremental atas 409 file berubah dan 35 terhapus membawanya dari 8.247 ke 9.574 node, 24.098 ke 26.456 edge, 495 ke 570 komunitas.

Tiga cacat senyap ikut tertutup:

- **`graph.json` tidak membawa `community_name` sama sekali.** Ia dibangun sebelum langkah pelabelan menulis label kembali ke sana, jadi `graphify query`, server MCP, dan konsumen GraphRAG mencetak `community=27` alih-alih nama komunitas — sementara label kurasinya hanya hidup di `.graphify_labels.json`, yang tidak ter-track. Sekarang 570 dari 570 node bernama di dalam artefak yang ter-track, sehingga label bertahan di clone baru.
- **Sidecar `.graphify_labels.json.sig` sudah basi dua hari terhadap labelnya** dan hanya cocok untuk 6 dari 495 komunitas. Satu jalannya `cluster-only` akan menamai ulang 489 komunitas memakai nama file hub dan menghapus nama kurasi tanpa peringatan apa pun. Sekarang cocok 570 dari 570.
- **`tree_sitter_sql` hilang setelah pemutakhiran graphify 0.9.27 → 0.9.35,** sehingga setiap berkas `.sql` menyumbang nol node sementara ekstraksi tetap melapor sukses. Di repositori yang tulang punggungnya `sql/NNN`, itu lubang cakupan, bukan kekurangan kosmetik.

Label lama juga mengandung cacat yang persis dilarang aturan penamaan komunitas: dua pasang duplikat dan 43 dari 495 berbentuk nama berkas — sisa penamaan hub otomatis. Seluruh 570 label ditulis ulang dan diverifikasi nol hilang, nol duplikat, nol berbentuk nama berkas. Pemeriksaan integritas graf bersih, dan `--update` sesudahnya melaporkan nol berkas berubah.
