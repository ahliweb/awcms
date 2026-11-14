🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0162-email-senders-verify-is-scheduled-hourly-as-a-named-app-role-exception.md)

<!-- i18n-source-hash: sha256:197cf00d6c86f5fe6b92bfa34079d42052bc8419f0083da4958bd26c9cbbc4a9 -->

# ADR-0162 — `email:senders:verify` dijadwalkan per jam sebagai pengecualian `awcms_app` bernama, dan job terjadwal berperan app adalah daftar tercatat yang diuji dua arah

- **Status:** Diterima (jadwal dan mekanisme pengecualian); pilihan `awcms_app` sebagai role job ini bersifat sementara menunggu konfirmasi pemilik (O1)
- **Tanggal:** 2026-11-14
- **Pengambil keputusan:** ahliweb (pemilik). Keputusannya sendiri diambil 11 November 2026 saat ADR-0159 diterima: "`email:senders:verify` is to be scheduled (follow-up PR)" ([`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4). Pemilik memutuskan BAHWA job ini dijadwalkan; pilihan login `awcms_app` sebagai role-nya dibuat di PR implementasi, bukan oleh pemilik, dan **sementara** sampai pemilik mengonfirmasi (lihat O1). ADR ini karena itu tidak mengklaim tanpa kewenangan baru: untuk pertama kalinya ia menaruh login app dan key ring rahasia dalam satu container terjadwal.
- **Menyelesaikan:** separuh jadwal Issue #1160 (job dan routing pengirim sudah ada; job itu `manual`).
- **Memperluas:** [ADR-0147](0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.id.md) (job `awcms_app` terjadwal pertama, yang dulu tunggal), [ADR-0151](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.id.md) §2 dan §6 (akun Mailketing tenant dan pengirim terverifikasi), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) §5 (rahasia kanal, key ring).
- **Terkait:** Issue #1132 (koneksi app ditahan dari setiap job crontab), [ADR-0160](0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.id.md) (job `awcms_app` terjadwal kedua).

**Tanpa migrasi, tabel, rute, atau event.** Perubahannya adalah sebuah jadwal, satu entri pengecualian, dan tes yang menjadikan setiap pengecualian semacam itu entri bernama, beralasan, dan diuji dua arah.

## Konteks

`email:senders:verify` membaca saldo kredit dan pengirim terverifikasi tiap akun Mailketing tenant (`GET /credits`, `GET /senders`, hanya-baca) lalu mencatatnya sebagai kesehatan akun. Pengirim tenant baru bisa dipakai bila penyedia melaporkannya terverifikasi, dan `email:dispatch` menahan pengirim yang kesehatannya lebih tua dari `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` (bawaan 360) atau tak diketahui. Dijalankan manual, tiap pengirim tenant basi setelah enam jam dan ditahan (gagal-tertutup), sehingga fitur ini tak dapat berjalan tanpa operator.

Dua aturan membuatnya `manual`:

1. Ia **menulis** kesehatan dan status channel-account, yang hanya boleh `awcms_app` (worker yang bisa menulisnya dapat menandai pengirim tak-terverifikasi sebagai terverifikasi).
2. Issue #1132 menahan `DATABASE_URL` (login `awcms_app`) dari setiap job crontab, jadi job berperan app butuh pengecualian tercatat. Sampai kini ada dua (ADR-0147, ADR-0160), tetapi hanya sebagai set tulisan tangan di dalam dua tes, tanpa alasan atau ADR.

## Keputusan

1. **Jadwalkan `email:senders:verify` per jam** (`0 * * * *`, `backlog: "bounded"`). Per jam enam kali lebih sering dari jendela kesegaran 360 menit, sehingga satu-dua lintasan gagal tidak mematikan pengirim. Job tetap no-op (exit 0) kecuali `EMAIL_SENDER_ROUTING_ENABLED` bernilai `"true"`, jadi memasang crontab tidak mengubah apa pun pada deployment yang belum menyalakan fitur.
2. **Ia diterima sebagai job `awcms_app` terjadwal ketiga**, dengan batas berikut, yang tidak dilebarkan ADR ini:
   - panggilan penyedia adalah **`GET` hanya-baca**; job tidak mengirim dan tidak membelanjakan apa pun;
   - kesehatan dan status ditulis hanya lewat `recordAccountHealth` milik `channel_accounts`, dalam transaksi tenant, di bawah RLS;
   - satu tenant yang gagal tidak menghentikan yang lain (lintasan menghitungnya dan keluar non-nol di akhir);
   - token didekripsi di memori, sekali per akun per lintasan, dan tidak pernah dicetak;
   - ia memegang `CHANNEL_SECRETS_ENCRYPTION_KEYS` lewat grant scoped per-job yang sudah ada, persis seperti sebelumnya.
3. **Pengecualian menjadi data.** `APP_ROLE_SCHEDULED_EXCEPTIONS` di `scripts/jobs-env-allowlist.ts` mendaftar tiap job terjadwal yang mempertahankan `DATABASE_URL`, beserta ADR Accepted-nya, satu entrypoint app-client-nya, dan alasannya. `tests/jobs-app-role-exceptions.test.ts` menegakkannya dua arah: job crontab yang mempertahankan kredensial tetapi tak terdaftar gagal; entri terdaftar yang tidak terjadwal, tak lagi mempertahankan kredensial, tanpa ADR atau alasan, atau yang entrypoint-nya bukan satu-satunya berkas dalam jangkauannya yang membuka koneksi app, gagal. Dua entri lama dipindahkan ke sana tanpa perubahan. Penurunan milik runner (`appConnectionTargets`, dari import closure) tidak disentuh: daftar ini tidak memberi izin apa pun, hanya menamai apa yang sudah diizinkan penurunan itu.

## Mengapa ini aman, dan apa yang tidak diklaim

- Container job ini kini memegang sekaligus login app dan key ring rahasia kanal. Proses web berjalan dengan environment penuh deployment, login yang sama dan (bila akun kanal dipakai) key ring yang sama, sehingga job tidak menambah kelas kemampuan baru yang dapat dinamai ADR ini; ia menambah satu tempat lagi tempat pasangan itu bersama, selama menit job berjalan tiap jam, tanpa permukaan masuk.
- Alternatif role worker tertutup oleh aturan 1 di atas. **Role database khusus** (`awcms_email_senders_verify`, pola `awcms_social_dispatch`) yang hanya memegang `UPDATE` kolom kesehatan dan baca RESTRICTIVE akun Mailketing adalah rancangan yang lebih sempit. Ia **tidak** dibangun di sini karena butuh migrasi, role, grant tingkat kolom, dan tes penyalahgunaan untuk job hanya-baca; ia dicatat sebagai keputusan terbuka di bawah dan menjadi langkah berikut yang tepat bila pemilik ingin job itu lepas dari login app.

## Keputusan terbuka

**O1 (butuh pemilik).** Konfirmasi `awcms_app` sebagai role job ini, atau pindahkan `email:senders:verify` ke role database khusus `awcms_email_senders_verify` (pola `awcms_social_dispatch`): `SELECT` RESTRICTIVE hanya atas secret `api_token` akun Mailketing `esp_account`, `UPDATE` hanya kolom kesehatan dan status (nilai dibatasi CHECK), dan runner menahan semua login bersama. Itu migrasi, role, pin readiness, dan tes penyalahgunaan, jadi menjadi isu tersendiri. Sampai pemilik memutuskan, pengecualian berlaku, dengan kontrol berikut:

- runner menahan `WORKER_DATABASE_URL` dari job ini (diturunkan dari import closure, `appRoleTargetsWithoutWorkerClient`), sehingga container memegang login app dan key ring tanpa kredensial ketiga;
- job keluar non-nol saat tak bisa bekerja sama sekali (tenant gagal, secret store tak tersedia, ada akun tetapi tak satu pun diperiksa), sehingga pemantauan cron melihat ring yang hilang atau salah, bukan sukses senyap tiap jam;
- daftar pengecualian digerbangi ADR yang sungguh berstatus Diterima/Accepted, dan pendeteksi koneksi app juga menangkap impor beralias klien app.

Sisa yang diketahui: dependensi terkompromi di closure job, atau eksekusi kode di container-nya, dapat membaca rahasia kanal semua tenant lewat `awcms_app` selama job berjalan. Proses web memegang pasangan yang sama terus-menerus, tetapi job menambah satu paparan terjadwal kedua.

## Konsekuensi

- Positif: pengirim tenant tetap terverifikasi tanpa operator; job berperan app tambahan tanpa ADR, atau pengecualian yang basi, memerahkan suite.
- Negatif: job ketiga berjalan dengan login aplikasi terluas pada timer; image job yang diretas akan memegangnya selama proses berjalan (dimitigasi oleh panggilan penyedia hanya-baca, scope rahasia per-job, dan pemeriksaan konsistensi runner/image per rilis yang sudah ada).
- Operasional: host memasang ulang `ops/awcms-jobs.crontab` dan pendamping `ops/run-job.sh` yang ter-generate seperti tiap rilis; runner sudah memberi target ini `DATABASE_URL`.

## Alternatif yang ditolak

- **Biarkan manual.** Gagal-tertutup pada setiap pengirim tenant setelah enam jam; ditolak oleh keputusan pemilik.
- **Jalankan di role worker.** Worker tak dapat menulis kesehatan channel-account, by design.
- **Lebarkan grant worker untuk menulis kesehatan.** Menggugurkan alasan kesehatan hanya milik app.
