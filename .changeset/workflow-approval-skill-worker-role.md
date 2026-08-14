---
"awcms": patch
---

docs(skill): `awcms-workflow-approval` menyatakan role `awcms_worker` TIDAK ADA — ia ada, dan salah arahnya berbahaya

Empat klaim di `.claude/skills/awcms-workflow-approval/SKILL.md` keliru, dan
semuanya ke arah yang sama: menyuruh pembacanya MEMBATALKAN pemisahan privilege
yang sudah terpasang.

- "Repo ini tidak punya role `awcms_worker`" — ia DIBUAT di
  `sql/022_awcms_db_worker_setup_roles.sql`.
- "`WORKER_DATABASE_URL` fallback ke `DATABASE_URL` … pemisahan privilege BELUM
  ada di sini" — produksi terverifikasi memakai `awcms_worker` untuk worker dan
  `awcms_app` untuk aplikasi.
- "Jangan tulis `GRANT … TO awcms_worker` — akan gagal jalan" — migrasi repo ini
  memuat **78** GRANT semacam itu yang sudah lama berjalan.
- "Temuan over-grant PR #778 vacuous di repo ini" — justru sebaliknya:
  `sql/022:145` sudah memberi `awcms_workflow_instances` `SELECT` SAJA, yakni
  persis bentuk perbaikannya, dan `WORKER_ROLE_GRANTS` di
  `scripts/security-readiness.ts` menjaganya.

**Kenapa arah salahnya yang penting.** Dokumen basi biasanya membuat orang
melakukan pekerjaan yang sudah tak perlu. Yang ini sebaliknya: agen yang
mempercayainya akan MENOLAK menulis GRANT worker untuk job baru dan
menjalankannya sebagai role pemilik — menghapus pemisahan privilege yang nyata.
Itu regresi keamanan yang lahir dari dokumentasi. Skill `awcms-deploy` sudah
dikoreksi untuk klaim kembar ini; berkas ini terlewat, dan `skills:check`
tidak bisa melihatnya karena ia memverifikasi bahwa path yang DIKUTIP ada,
bukan bahwa kalimat di sekitarnya benar.

Ditemukan saat menjadwalkan job yang selama ini tidak pernah berjalan:
`workflow:escalations:dispatch` termasuk 31 dari 32 job yang tak ter-cron, dan
pertanyaan "role apa yang dipakainya" langsung menabrak klaim ini.
