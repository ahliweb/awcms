🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](lessons-learned.md)

<!-- i18n-source-hash: sha256:2cc15a3afca9219f38de3c8dadc714dd16a2d4a45bc724720b7dbde7181e3d9c -->

# Pelajaran yang dipetik

Pelajaran operasional yang mahal didapat, mudah dilupakan dan mahal
dipelajari ulang — masing-masing menunjuk ke tempat kisah lengkapnya hidup.
Tambahkan ke daftar ini hanya ketika sebuah kesalahan benar-benar terjadi dan
sudah diperbaiki; jangan menulis pelajaran hipotetis di muka.

- **"Jalankan, jangan dibaca."** Skrip atau gerbang yang tidak pernah
  dieksekusi terhadap cacat nyata belum terbukti. Lihat
  [`../../docs/PROJECT_STATE.md`](../../docs/PROJECT_STATE.md) untuk pola dan
  insiden berulangnya; `tests/graph-artifacts-check.test.ts` dan
  `tests/knowledge-obsidian-sync.test.ts` keduanya mengikuti ini — setiap
  aturan diberi input rusak yang sungguhan dan wajib menjadi merah, bukan
  sekadar terbukti hijau di tree yang sehat.
- **Graf mencampur "pernah benar" dengan "benar sekarang."** Lihat
  [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  §"Dua cara salah membaca ini".
- **Kohesi rendah pada chokepoint yang disengaja bukan utang desain.**
  Dokumen yang sama, §2.
- **Gerbang yang hanya membaca separuh Inggris dari pasangan dwibahasa
  melewatkan mirror yang basi.** [`../../docs/PROJECT_STATE.md`](../../docs/PROJECT_STATE.md)
  §4, "audit yang diminta #727 menemukan sesuatu yang lebih besar dari #727".
- **`graphify install` menimpa patch skill lokal saat upgrade.** Backup dan
  terapkan ulang — inilah kenapa repo ini tidak meng-commit project-scoped
  Graphify skill (lihat `docs/awcms/knowledge-graph.md` §Baseline).
