---
"awcms": patch
---

docs: alur pengembangan punya dokumen kanonik, dan sejarah pindah keluar dari README

`docs/awcms/alur-pengembangan.md` — 18 langkah dari Master Blueprint sampai
post-release review, tiap langkah dipetakan ke artefak NYATA di repo ini dan
gerbang yang menegakkannya. Ia menggantikan `alur-pengembangan-mini-first.md`
(sudah dicabut ADR-0055) dan menjadi dokumen yang mengikat; `CONTRIBUTING.md`
dan §"Alur kerja wajib" `AGENTS.md` keduanya kini menyatakan diri sebagai
**langkah 10–12 saja**.

DUA HAL YANG MEMBUATNYA BUKAN SEKADAR DIAGRAM. Pertama, tabel **kelas
perubahan**: tidak setiap perubahan menempuh 18 langkah, dan yang menentukan
bukan selera — perbaikan bug tanpa perubahan kontrak menempuh 10→12, modul baru
dan perubahan lapisan fondasi menempuh 1→12 penuh plus ADR. Kedua, **celah
ditulis sebagai celah**: dokumen proses yang menyamarkan langkah yang tidak
punya artefak adalah dokumen yang dipercaya lebih dari yang pantas.

SATU KONFLIK TERBUKA, DAN IA KEPUTUSAN PEMILIK REPO. Langkah 13 (Deploy
Staging) bertentangan dengan ADR-0083, yang menyatakan template ini men-deploy
ke SATU environment: produksi. Langkah 14 (UAT internal) bergantung padanya.
Dokumen menuliskannya sebagai konflik terbuka alih-alih memilih diam-diam salah
satu sisinya.

TIGA CELAH LAIN yang tidak bertentangan dengan apa pun: privacy analysis/DPIA,
Definition of Ready umum (yang ada hanya admission checklist untuk modul baru),
dan post-release review per-rilis. Langkah 9 punya bukti biayanya sendiri di
repo ini — dua gelombang berturut-turut menulis rencana yang mengasumsikan
pembacaan lintas-tenant yang FORCE RLS larang, dan keduanya baru ketahuan saat
implementasi.

Sejarah repo pindah dari `README.md` ke `docs/awcms/sejarah-repo.md`: README
seharusnya menjawab "ini apa, sekarang", dan sejarah yang menumpuk di bagian
depan pelan-pelan mengubur jawaban itu.

Ketiga agen di `.claude/agents/` menunjuk dokumen alur. Reviewer diminta
menentukan KELAS perubahan lebih dulu — menuntut ADR pada perbaikan bug
memboroskan waktu orang, dan melewatkannya pada perubahan fondasi meloloskan
keputusan yang tak pernah ditulis. Auditor diingatkan pada aturan yang berlaku
untuk setiap temuannya: sebuah kontrol belum terbukti sampai ia dibuktikan
GAGAL pada kondisi yang seharusnya.
