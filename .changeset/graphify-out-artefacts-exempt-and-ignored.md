---
"awcms": patch
---

Artefak graphify berhenti menuntut changeset, dan permukaan render-nya berhenti mengintai untuk ikut ter-commit

Tiga pembenahan kebersihan repositori di sekitar `graphify-out/`, tidak satu pun menyentuh perilaku aplikasi.

**Gerbang changeset mengecualikan tiga artefak graf yang ter-track.** Sebelum ini setiap pembangunan ulang graf harus mengarang changeset `patch`, sehingga penyegaran artefak murni menaikkan versi rilis dan menulis baris changelog yang tak bisa ditindaklanjuti pengguna paket mana pun. `graph.json`, `manifest.json`, dan `cost.json` kini dikecualikan — `GRAPH_REPORT.md` sudah lebih dulu lewat pola `.md`.

Pengecualiannya **dienumerasi, bukan `/^graphify-out\//`**, dengan alasan yang sama membuat temuan security-auditor di PR #715 mempersempit entri `.claude/`: pengecualian se-direktori juga menutupi apa pun yang dijatuhkan proses lain ke sana kelak. Berkas artefak keempat harus melewati daftar ini secara sengaja, bukan mewarisi pengecualian yang tak pernah ditinjau untuknya. Sebuah test membuktikan kesempitan itu: melebarkan pola menjadi se-direktori membuat test merah, dan hanya test itu.

**Empat artefak render graphify masuk `.gitignore`.** `graph.svg`, `graph.graphml`, `GRAPH_TREE.html`, dan `*-callflow.html` berjumlah 49 MB pada graf 9.574 node, melawan 15 MB milik `graph.json`. Melacaknya akan melipatempatkan lebih dari apa yang ditambahkan setiap penyegaran graf ke riwayat selamanya, dan tiap berkas membusuk dengan cara yang sama seperti `graph.html` — yang sudah lebih dulu diabaikan dengan alasan tertulis yang sama. Semuanya satu perintah dari regenerasi.

**`graphify-out/.graphify_labels.json.sig` tidak lagi dilacak.** Aturan `.gitignore` `graphify-out/.*` bermaksud mengeluarkannya sejak awal, tetapi aturan tidak bisa membatalkan pelacakan berkas yang sudah terlanjur ter-commit. Salinan yang ter-track hanya bisa basi: ia adalah tanda tangan keanggotaan komunitas yang berpasangan dengan `.graphify_labels.json`, yang memang tak pernah dilacak — jadi sebuah clone menerima tanda tangan tanpa label yang ia jelaskan. Nama komunitas tetap aman di `graph.json`, yang membawanya per-node.
