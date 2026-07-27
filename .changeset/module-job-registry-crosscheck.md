---
"awcms": minor
---

Bandingkan dua registry job yang selama ini mendeskripsikan skrip yang sama tanpa
ada yang membandingkannya.

`JOB_WORK_CLASS_REGISTRY` menyatakan anggaran pool sebuah skrip, dan sudah
ditegakkan ke ground truth — generatornya MENOLAK jalan saat peta dan disk
berselisih. `ModuleDescriptor.jobs` menyatakan sebuah job untuk APA dan seberapa
sering operator harus menjalankannya (`recommendedSchedule`), dan disajikan lewat
`GET /api/v1/modules/{moduleKey}/jobs`. Yang pertama ditegakkan ke filesystem;
yang kedua tidak ditegakkan ke apa pun.

Akibatnya sebuah skrip worker bisa sepenuhnya masuk model kapasitas tapi tetap
tak terlihat di satu-satunya permukaan yang dibaca operator untuk tahu bahwa job
itu perlu dijadwalkan — dan dua memang begitu:

- **`tenant-domain:dns:sync`** — modul `tenant_domain` tak mendeklarasikan `jobs`
  sama sekali. Deskriptornya ditambahkan (jadwal: tiap 15 menit; `manual` sebagai
  default tak melakukan panggilan keluar).
- **`edge-cache:purge`** — tak ada modul `edge_cache` untuk menggantungkan
  deskriptornya: edge cache adalah infrastruktur `src/lib/` (ADR-0043), sementara
  `ModuleDescriptor.jobs` di-key per modul. Dicatat sebagai pengecualian dengan
  alasan STRUKTURAL, bukan "belum sempat".

`modules:jobs:check` (baru, di rantai `check`) menegakkan keduanya: tiap skrip di
work-class registry wajib punya deskriptor dengan `recommendedSchedule` tak
kosong. Job yang tak dijadwalkan tak pernah jalan dan tak ada yang memberi tahu —
tak ada gate, tak ada health check, tak ada alarm.

Tabel §Job registry di `deployment-profiles.md` dihapus alih-alih diperbarui: ia
salinan tangan yang menua persis seperti yang diperkirakan, memuat tiga command
ERP yang tak pernah ada sambil melewatkan sepuluh job yang benar-benar dikirim.
§Shared worker runner juga dikoreksi — ia mengklaim ketujuh dispatcher memakai
`runJob`, padahal `email:dispatch` dan `sync:objects:dispatch` memakai claim-lease
per baris, yang justru MENGIZINKAN worker paralel; empat job lain belum memakai
keduanya dan kini terdaftar apa adanya.
