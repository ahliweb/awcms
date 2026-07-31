---
"awcms": patch
---

Perluas gerbang rujukan `bun run` ke README modul dan **komentar kode**, lalu
perbaiki tujuh rujukan hantu yang selama ini hidup di balik `check` hijau.

`checkKnownScripts` hanya membaca lima berkas markdown akar (`README*.md`,
`AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`). Di luar lima itu, sebuah
perintah yang tidak pernah ada tetap bisa berdiri sebagai instruksi. Tujuh
ditemukan:

- Enam komentar di `src/lib/jobs/` + `src/modules/module-management/` menyuruh
  pembacanya menjalankan target `modules:sync`. Target itu **tidak pernah ada di
  repo ini** — mekanismenya `POST /api/v1/modules/sync`, dan `enableTenantModule`
  bahkan sudah memanggil `syncModuleDescriptors` sendiri supaya operator tak
  perlu mengingat apa pun.
- `src/modules/blog-content/README.md` mendaftarkan `bun run production:preflight`
  di antara perintah verifikasi nyata. Orkestrator itu belum diport; tiga
  tahapnya yang sudah nyata (`config:validate`, `security:readiness`,
  `db:pool:health`) menggantikannya.

Komentar kode adalah dokumentasi current-state yang paling dipercaya sekaligus
yang paling tidak pernah diaudit — ia dibaca persis saat seseorang sedang
memutuskan tindakan. Karena itu cakupan gerbang kini: lima berkas akar +
`docs/PROJECT_STATE.md` + `scripts/README.md` + README modul `src/**` + seluruh
sumber `src/`/`scripts/`. `docs/awcms/` dan `.claude/skills/` tetap di luar —
isinya target adaptasi awcms-mini yang memang boleh menyebut tooling belum-ada —
begitu pula `tests/`, yang fixture-nya sengaja memakai nama fiktif untuk menguji
gerbang ini.

Kelas cacatnya dibuktikan dua arah sebelum ditutup: mengembalikan komentar
`modules:sync` yang asli DAN menambahkan satu rujukan hantu ke
`docs/PROJECT_STATE.md` masing-masing memerahkan gerbang. Gerbangnya juga
langsung menangkap komentar penjelasnya sendiri pada run pertama — kali kelima
bentuk itu muncul di repo ini, dan alasan komentar itu kini sengaja tidak menulis
nama target dalam bentuk `bun run …`.

Dokumen current-state ikut disegarkan agar tidak berbohong ke arah sebaliknya:
`docs/ARCHITECTURE.md` masih menulis "20 modul terdaftar" (21) dan **dua kali**
menyebut `idn-admin-regions` sebagai "belum di-port" padahal modul itu sudah
mendarat (#312) — klaim negatif yang makin salah seiring waktu tanpa pernah gagal
sendiri. `docs/PROJECT_STATE.md` disetel ulang ke 21 modul / ADR 0000–0048, dan
kontrak alur kerjanya tidak lagi mewajibkan mini-first yang sudah **ditangguhkan**
ADR-0047.
