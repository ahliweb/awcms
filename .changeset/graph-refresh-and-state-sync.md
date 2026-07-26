---
"awcms": patch
---

Refresh knowledge graph ke `85517b8b` (7534 node, 21084 edge, 434 community; nol
import cycle level-berkas) dan koreksi satu klaim usang di `PROJECT_STATE.md`.

Dokumen itu masih menyatakan emisi purge cache tepi "belum" terpasang untuk
`theming` — padahal #246 sudah memasangnya di publish/rollback/retire. Sekaligus
menjelaskan kenapa `news_portal`/`media_library` sengaja TIDAK: keduanya tidak
memiliki surface ter-deklarasi, jadi ban untuk key-nya tak akan cocok apa pun
sementara antrean tetap melapor sukses — dan gate `edge-cache:surfaces:check`
akan memunculkan kewajibannya sendiri begitu salah satunya mendeklarasikan
surface.
