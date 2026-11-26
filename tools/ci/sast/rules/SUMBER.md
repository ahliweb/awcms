# Sumber aturan SAST

Salinan aturan, bukan tulisan repo ini. Jangan edit tangan; sinkron ulang dengan skrip.

- Repo: https://github.com/opengrep/opengrep-rules (diarsipkan upstream)
- Commit: `f1d2b562b414783763fd02a6ed2736eaed622efa`
- Tanggal commit: 2025-01-26T16:41:13+01:00
- Disalin pada: 2026-11-27
- Cakupan: semua berkas `.yaml` dan `.yml` di `javascript/` dan `typescript/` (203 berkas), ditambah `LICENSE` upstream utuh.
- Lisensi: Commons Clause + LGPL 2.1 (lihat `LICENSE`). Syarat Commons Clause menahan hak MENJUAL perangkat lunak; memakai aturan di CI internal tidak dibatasi.
- Tidak dipakai: aturan Semgrep Registry (`p/...`) dan repo semgrep/semgrep-rules.
- Aturan milik repo ada di `lokal/` dan tidak disentuh sinkron.

## Sinkron ulang

```bash
bun tools/ci/sast/opengrep-scan.ts sinkron-aturan
```

Skrip meng-clone sparse ke direktori sementara, checkout commit terpin di atas, memverifikasi `git rev-parse HEAD`, menyalin berkas, lalu menulis ulang berkas ini. Untuk pindah commit, ubah `RULES_COMMIT` di `opengrep-scan.ts` lewat PR, sinkron, lalu perbarui baseline dengan tinjauan manusia.
