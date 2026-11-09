---
name: pengetahuan-ringkas
description: "Gunakan SEBELUM membaca banyak berkas untuk menjawab pertanyaan arsitektur, hubungan antarberkas, alur data, 'di mana X didefinisikan', 'apa yang memanggil Y', atau 'apa dampak mengubah Z'. Membaca peta knowledge graph graphify di graphify-out/ lebih dulu agar hemat token, lalu memverifikasi ke berkas sumber."
---

<!-- pengetahuan-ringkas:v1 -->

# Pengetahuan Ringkas (graphify + Obsidian)

## Metadata

- Version: `v1.2.0`
- Last updated: `2026-11-09`
- Changeset: `Menambahkan aturan retensi lokal: maksimal dua keadaan graf (terakhir dan proses update), tanpa salinan atau cadangan lain.`

Repo ini punya knowledge graph di `graphify-out/`. Tujuannya satu: menjawab pertanyaan struktur dengan membaca peta kecil, bukan puluhan berkas, sehingga token AI lebih hemat.

## Urutan kerja

1. Buka `graphify-out/GRAPH_REPORT.md` (god node, komunitas, pertanyaan yang disarankan).
2. Tanyakan ke graf:
   - `graphify query "<pertanyaan>"` untuk konteks luas (tambah `--dfs` untuk menelusuri satu jalur, `--budget N` untuk membatasi token).
   - `graphify path "A" "B"` untuk jalur terpendek antara dua konsep.
   - `graphify explain "X"` untuk penjelasan satu node beserta tetangganya.
3. Buka hanya berkas sumber yang dikutip `source_file` pada hasilnya.
4. Di agent: `/graphify query "<pertanyaan>"` setara dengan perintah di atas.

## Graf adalah peta, bukan sumber kebenaran

- Verifikasi setiap klaim ke `source_file` yang dikutip sebelum dijadikan dasar keputusan atau perubahan.
- Edge `INFERRED` dan `AMBIGUOUS` bukan fakta; hanya `EXTRACTED` yang tertulis eksplisit di sumber.
- Bila graf dan berkas berbeda, berkas yang benar dan graf yang basi.

## Status graf: kode saja atau penuh

- Bila `graphify-out/STATUS.md` ada, graf baru berisi **kode (AST)**: dokumen (Markdown, PDF, gambar) belum diekstrak. Untuk pertanyaan tentang dokumen, jalankan dulu `/graphify . --update` lewat skill `graphify`, lalu hapus `graphify-out/STATUS.md` dan commit hasilnya bersama perubahan terkait. Ekstraksi dokumen memakai LLM (agent sendiri atau Gemini bila kunci tersedia) dan memakan token sekali di awal; hasilnya di-cache.
- Bila `STATUS.md` memuat `Mode: lokal-saja`, graf terlalu besar untuk di-commit: bangun lokal dengan `graphify update .` dan jangan di-commit (`graph.json` dan `GRAPH_REPORT.md` diabaikan git).
- Tanpa `STATUS.md`, graf dianggap sudah memuat dokumen.
- Graf kode murni tidak memerlukan API key dan tidak memakai LLM: `graphify update .`.

## Memperbarui graf

- Setelah menambah, menghapus, atau mengubah substansial berkas, perbarui graf **dalam commit yang sama** dengan perubahannya.
  - Hanya kode berubah: `graphify update .` (tanpa LLM).
  - Dokumen berubah: `/graphify . --update` (hanya berkas baru/berubah yang diekstrak ulang).
- Perapian kata dan komentar tidak perlu memperbarui graf.
- Bila graf baru lebih kecil karena berkas dihapus, graphify menolak menimpa; ulangi dengan `--force` hanya setelah memastikan pengecilan itu disengaja.

## Larangan

- Jangan mengedit isi `graphify-out/` dengan tangan.
- Jangan memasang `graphify hook install`: hook mengubah `graph.json` setelah commit sehingga working tree kotor, dan hanya menyegarkan kode.
- Jangan memasukkan rahasia, token, atau data pribadi ke berkas yang masuk graf; graphify melewatkan berkas sensitif, tetapi tetap periksa.

## Retensi lokal

Di mesin lokal, graf sebuah repo hanya boleh ada dalam **dua keadaan**: graf terakhir yang sudah selesai (`graphify-out/` yang dilacak Git) dan proses update yang sedang berjalan. Selesai berarti keadaan baru menggantikan yang terakhir; gagal berarti proses dibuang.

- Jangan menyimpan salinan atau cadangan lain dari `graphify-out/` (mis. `graphify-out.bak`, `graph.json.old`, salinan per tanggal, klon cadangan per run).
- Bila update gagal atau hasilnya buruk, kembalikan dari Git (`git restore graphify-out/` atau `git checkout -- graphify-out/`), jangan menyimpan salinan manual.
- Hapus sisa proses yang tertinggal sebelum memulai update baru.

## Repo yang diarsipkan

Jangan membangun atau memperbarui graf, dan jangan membuat vault Obsidian, di repo yang sudah diarsipkan (read-only di GitHub), termasuk di salinan lokalnya. Graf yang sudah ada di repo arsip dibiarkan apa adanya dan tidak diperbarui.

## Artefak: dilacak Git vs tidak

| Berkas                                                                                | Dilacak | Catatan                                                                    |
| ------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `graphify-out/graph.json`                                                             | Ya      | Dibaca `graphify query` dan agent lain tanpa membangun ulang; path relatif |
| `graphify-out/GRAPH_REPORT.md`                                                        | Ya      | Ringkasan god node dan komunitas                                           |
| `graphify-out/STATUS.md`                                                              | Ya      | Penanda graf kode saja; dihapus setelah ekstraksi dokumen                  |
| `graphify-out/.graphify_labels.json{,.sig}`                                           | Ya      | Nama komunitas hasil kurasi                                                |
| `graphify-out/cache/`, `manifest.json`, `cost.json`, `graph.html`, `.graphify_*` lain | Tidak   | Berisi mtime/hash lokal atau dibuat ulang                                  |
| `graphify-out/obsidian/`                                                              | Tidak   | Vault lokal                                                                |

`.graphifyignore` mengatur cakupan graf (sintaks gitignore). Tambahkan baris di sana bila ada folder besar yang bukan objek pertanyaan; jangan mengecualikan kode milik repo.

## Obsidian (opsional, lokal)

- `graphify export obsidian` (atau `/graphify . --obsidian` di agent) membuat vault graf di `graphify-out/obsidian/`: satu catatan per node plus `graph.canvas`. Folder ini diabaikan Git dan ditimpa saat ekspor ulang; jangan diedit.
- Buka folder itu dengan aplikasi Obsidian (Open folder as vault). Aplikasi harus dipasang pemilik mesin; skill ini tidak memasangnya.

## Bila CLI `graphify` tidak ada

Pasang paket `graphifyy`: `uv tool install graphifyy` atau `pipx install graphifyy`. Graf kode tidak memerlukan API key. Skill agent `graphify` bisa dipasang dengan `graphify install`.

## Changelog

### 2026-11-09 - v1.2.0

- Menambahkan §Retensi lokal: maksimal dua keadaan graf per repo, tanpa salinan atau cadangan lain.
- Menambahkan §Repo yang diarsipkan: tanpa graf baru, pembaruan graf, atau vault Obsidian.

### 2026-11-09 - v1.1.0

- Menambahkan mode graf lokal-saja (`STATUS.md` berisi `Mode: lokal-saja`).

### 2026-11-09 - v1.0.0

- Baseline skill `pengetahuan-ringkas`.
