---
"awcms": patch
---

docs(state): putaran kelima 11 Agustus — Gelombang 4 selesai

`docs/PROJECT_STATE.md` §4 mencatat putaran ini: apa yang mendarat (ADR-0082,
#512, #513), empat tempat rencana program tidak diikuti beserta alasannya yang
diperiksa terhadap kode, dua cacat yang ditemukan dengan MENJALANKAN bukan
membaca, tujuh penolakan, dan satu batas gerbang yang wajib dibaca sebelum
config module berikutnya memakai pola `env: NodeJS.ProcessEnv = process.env`.

Daftar ini ada DI SINI karena aturan yang sama dengan empat putaran sebelumnya:
daftar yang tidak ditulis ke repo harus diturunkan ulang, dan menurunkan ulang
berharga satu audit penuh sementara menuliskannya berharga satu paragraf.
Penolakan ikut tertulis, karena penolakan yang tidak tercatat akan diusulkan
lagi.

`src/modules/identity-access/README.md` mendapat bagian Undangan. README modul
adalah dokumen current-state yang menjelaskan setiap fitur lain modul ini;
membiarkan permukaan sebesar ini tak tertulis di sana adalah bentuk penuaan yang
persis dikeluhkan ADR-0062 tentang skill — dengan bedanya README dibaca, bukan
diikuti.
