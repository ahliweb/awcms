---
"awcms": patch
---

Naikkan `github/codeql-action` 4.37.1 → 4.37.3 untuk `init` DAN `analyze` dalam
satu perubahan.

Dependabot memecah bump ini jadi dua PR (#284 `init`, #286 `analyze`) karena
keduanya dilacak sebagai action terpisah. Dipecah, masing-masing PR menjalankan
`init` dan `analyze` pada versi yang BERBEDA, dan job `Analyze` gagal dengan
version mismatch — persis itu yang terjadi: kedua PR merah di `Analyze
(actions)` dan `Analyze (javascript-typescript)` sementara seluruh check lain
hijau. Keduanya menunjuk SHA yang sama (`e4fba868`), jadi digabung di sini dan
kedua PR dependabot ditutup.
