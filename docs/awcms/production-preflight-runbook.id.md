🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](production-preflight-runbook.md)

<!-- i18n-source-hash: sha256:42532a107274932dc7c15f320e5bc8763fe39289bfa6642eb03256903c9300f8 -->

# Preflight Produksi — Runbook Gladi, Apply, dan Rollback

> **Status dokumen (AWCMS, tahap foundation-rebuild).** Orkestrator yang
> menjadi pusat runbook ini **tidak ada di sini**: tidak ada
> `scripts/production-preflight.ts`, tidak ada `authorizeApply`, dan tidak
> ada key `production:preflight` di `package.json`. Baca setiap klaim
> "tersedia"/"sudah berjalan" di bawah sebagai **spesifikasi**, bukan
> status saat ini.
>
> Yang NYATA, sebagai perintah berdiri sendiri: `config:validate`,
> `security:readiness`, `db:pool:health` (lihat
> [`production-readiness.md`](production-readiness.md)) dan `db:migrate`.
> Urutan go/no-go yang merangkainya, plus tahap `database:capacity`,
> `db:connectivity` dan `migration:plan`, belum dibangun.
>
> `deploy/` tidak lagi sekosong yang dulu diklaim banner ini. Kini berisi
> `deploy/backup/backup-postgres.sh` dan `deploy/backup/restore-postgres.sh`
> (nyata, dipakai §Stage 2), `deploy/pgbouncer/pgbouncer.ini.example`,
> `deploy/redis/docker-compose.yml`, dan `deploy/cron/awcms.crontab`. Tidak
> ada `deploy/backup/README.md` dan tidak ada `offsite-copy.sh`, dan kedua
> skrip backup itu **tidak** mengimplementasikan enkripsi maupun manifest
> HMAC — detailnya di §Stage 2.

Pendamping `docs/awcms/07_sprint_testing_production_readiness.md` —
dokumen ini membahas prosedur operasional di sekitar `bun run
production:preflight`, bukan checklist-nya sendiri. Lihat juga
[`resilience-dr-verification.md`](resilience-dr-verification.md) untuk
`bun run resilience:dr-drill` — injeksi kegagalan terkendali dan
verifikasi DR (interupsi worker, outage provider, backup/restore/
rollback), perkakas yang saling melengkapi tapi berbeda: preflight
memeriksa kesiapan untuk migrasi/deploy; gladi DR membuktikan perilaku
pemulihan benar-benar bekerja di bawah kegagalan terkendali.

## Kenapa ini ada

Sebelum isu yang mendasarinya diperbaiki di base, `bun run
production:preflight` menjalankan `bun run db:migrate` sebagai tahap awal
tanpa syarat — tahap yang lebih belakangan gagal (spec check, test, build)
tetap meninggalkan database target dalam keadaan termigrasi, sekalipun
vonis akhir skrip itu sendiri adalah "GO-LIVE DIBLOKIR". Preflight yang
memutasi targetnya bahkan ketika ia memblokir go-live tidak aman
dijalankan berulang, dan itu meniadakan gunanya sebuah preflight.

`bun run production:preflight` bersifat **read-only secara default**. Ia
menjalankan sembilan tahap (`config:validate`, `security:readiness`,
`database:capacity` — pemeriksaan anggaran kapasitas koneksi yang
sadar-deployment, lihat
[`database-capacity-runbook.md`](database-capacity-runbook.md) —
`db:connectivity`, `api:spec:check`, `test`, `build`, `db:pool:health`,
`migration:plan`) dan melaporkan vonis go/no-go — tak satu pun dari mereka
menulis ke database. Menerapkan migrasi yang tertunda adalah aksi
terpisah, eksplisit, dan digerbangi.

## Tahap 1 — Gladi (hanya bila ada environment kedua)

> **Repo ini tidak punya satu pun, dan profil untuk itu pun tidak ada.**
> Menurut
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md)
> (sebagaimana diamandemen) template ini men-deploy ke tepat satu
> environment hidup — produksi — dan `staging` sudah dihapus dari
> kosakata deployment-profile itu sendiri: profil yang tersisa adalah
> `development`, `production`, dan `offline-lan`. Karena itu tahap ini
> menggambarkan environment gladi yang seseorang pilih untuk didirikan,
> bukan tingkatan bernama yang dikirim template. Kontrak isolasinya ada di
> [`environments.md`](environments.md) §Kontrak isolasi environment kedua.
> Di sini tahap ini tidak punya target, dan yang berdiri menggantikannya
> sengaja dibuat lebih sempit: suite integrasi CI terhadap layanan
> PostgreSQL nyata, ditambah backup yang teruji-restore dari Tahap 2 —
> yang berhenti menjadi formalitas begitu tidak ada yang menggladi
> migrasinya lebih dulu. Itu mitigasi, bukan pengganti yang setara;
> ADR-0083 §Konsekuensi mencatat apa yang dikorbankan alih-alih
> berpura-pura itu gratis.

Bila environment gladi memang ada, jangan pernah menjalankan
`--apply-migrations` terhadap produksi tanpa lebih dulu menggladi migrasi
yang persis sama di sana, terhadap salinan produksi yang mutakhir.

1. Restore backup produksi yang mutakhir ke dalamnya (lihat §Bukti backup
   di bawah — jalur restore yang sama sekaligus membuktikan "backup-nya
   bekerja" dan memberimu database gladi yang realistis dalam satu
   langkah). Environment itu berutang kontrak isolasi penuh kepada
   produksi: database sendiri, role dan password sendiri, secret sendiri,
   integrasi keluar dimatikan.
2. Jalankan preflight read-only terhadapnya:
   ```bash
   APP_ENV=production DATABASE_URL=<rehearsal-url> bun run production:preflight
   ```
   Pastikan `GO-LIVE DIIZINKAN` dan baca keluaran tahap `migration:plan`
   — ia mendaftar persis migrasi mana yang tertunda, per nama.
3. Terapkan terhadapnya:
   ```bash
   APP_ENV=production DATABASE_URL=<rehearsal-url> bun run production:preflight \
     --apply-migrations --backup-verified --acknowledge-target=production
   ```
   `--acknowledge-target` wajib sama dengan `APP_ENV`, jadi ia tidak bisa
   membedakan database gladi dari yang asli. Yang membedakan keduanya
   adalah `DATABASE_URL` — baca ulang nilainya sebelum kamu menekan enter.
4. Smoke-test environment itu (wizard setup sudah dijalankan / login
   admin / satu alur CRUD atau posting yang representatif untuk tiap modul
   yang tersentuh migrasi tertunda — mis. sebuah posting buku besar atau
   pergerakan stok begitu modul-modul itu ada).
5. Jalankan gladi DR penuh (lihat
   [`resilience-dr-verification.md`](resilience-dr-verification.md))
   terhadap **restore sekali-buang dari backup yang sama**, bukan terhadap
   environment gladi yang barusan kamu jalankan dengan aturan produksi:
   ```bash
   APP_ENV=test DATABASE_URL=<throwaway-url> \
   bun run resilience:dr-drill -- --confirm-non-production=test --full
   ```
   Pemisahan itu dipaksakan, bukan gaya-gayaan: interlock keselamatan
   gladi itu sama sekali tidak memberi flag override untuk
   `APP_ENV=production`, sehingga environment yang dikonfigurasi
   menjalankan aturan produksi tidak akan pernah bisa menjadi targetnya.
   Menghapus `staging` menghapus satu-satunya nilai `APP_ENV` yang dulu
   sekaligus mirip-produksi dan bisa digladi; `test` adalah yang tersisa,
   dan ia tidak menyalakan aturan produksi. Pastikan `overall = pass` —
   inilah bukti gladi backup/restore/rollback H-7/H-3 yang diminta rencana
   go-live doc 07, dihasilkan sebagai laporan JSON yang reproducible
   alih-alih restore manual ad hoc.
6. Baru lanjut ke produksi begitu gladi itu bersih. Tanpa environment
   kedua — kasus repo ini — tidak ada satu pun di sini yang bisa dilewati
   dalam arti "sudah dikerjakan di tempat lain": Tahap 2 menjadi seluruh
   jaring pengamannya, jadi uji restore itu wajib, bukan sekadar
   disarankan.

## Tahap 2 — Bukti backup (wajib sebelum `--apply-migrations` apa pun)

Bukti backup adalah atestasi operator, bukan pemeriksaan otomatis — kamu
menyatakan adanya jejak bukti yang spesifik, bukan sekadar ingat bahwa ada
backup di suatu tempat.

> **Koreksi (27 Agustus 2026).** Sampai sekarang bagian ini menggambarkan
> backup terenkripsi dengan manifest bertanda-tangan HMAC dan nama berkas
> `.dump.enc`. **Tidak satu pun dari itu diimplementasikan.**
> `backup-postgres.sh` menulis dump `--format=custom` polos plus sidecar
> `.sha256`, dan ia **menolak jalan** bila `BACKUP_ENCRYPTION_KEY_FILE`
> atau `BACKUP_HMAC_KEY_FILE` di-set — pesan error skrip itu sendiri
> menyebut dokumen ini sebagai yang melebih-lebihkannya.
> `restore-postgres.sh` tidak mendekripsi apa pun, tidak memverifikasi
> manifest apa pun, dan menolak berkas `.enc` alih-alih menebak.
> `deploy/backup/README.md` dan `deploy/backup/offsite-copy.sh` juga tidak
> ada. Yang NYATA adalah sidecar sha256, diverifikasi sebelum mutasi apa
> pun, dan default database scratch di bawah.

```bash
DATABASE_URL=<production-url> \
BACKUP_DIR=/var/backups/awcms \
./deploy/backup/backup-postgres.sh
```

Lalu **buktikan dump-nya bisa direstore** — dump yang tidak pernah
diuji-restore bukanlah bukti terverifikasi. `restore-postgres.sh`
memverifikasi sidecar `.sha256` sebelum menyentuh database target mana pun:

```bash
DATABASE_URL=<production-url> \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump
```

(Secara default merestore ke database sekali-buang `awcms_restore_test` —
tidak pernah ke yang hidup; `RESTORE_SCRATCH_DB` mengganti nama itu.) Catat
nama berkas dump, digest `sha256`-nya, dan stempel waktu uji-restore di
tempat yang awet (tiket deploy/log runbook) — inilah "retensi bukti" yang
diminta runbook ini.

Salinan luar-lokasi tetap kewajiban nyata yang tidak punya skrip: salin
sendiri dump beserta sidecar-nya ke host kedua. Uji-restore-lah yang
membuktikan backup itu bisa dipakai; salinan luar-lokasi soal bertahan dari
hilangnya host backup, dan tidak ada apa pun di repo ini yang
mengotomasinya.

## Tahap 3 — Preflight produksi (read-only)

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight
```

Baca laporan lengkapnya. Khususnya:

- `db:pool:health` — bila ini menunjukkan `SKIP`, vonisnya **sudah**
  `GO-LIVE DIBLOKIR` saat `APP_ENV=production` (aturan skip-wajib) —
  nyalakan servernya (`bun run preview` setelah `bun run build`) supaya
  tahap ini benar-benar bisa berjalan sebelum melanjutkan.
- `migration:plan` — daftar persis migrasi yang akan diterapkan. Diff
  daftar ini terhadap apa yang kamu gladi di Tahap 1; keduanya wajib cocok
  persis. Ketidakcocokan (satu migrasi tertunda tambahan yang tidak kamu
  gladi) berarti berhenti dan gladi dulu, bukan menerapkannya secara buta.

Opsional, tangkap salinan laporan yang terbaca-mesin untuk catatan deploy:

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight \
  --json-output=/var/log/awcms/preflight-$(date +%Y%m%d_%H%M%S).json
```

## Tahap 4 — Apply (produksi)

Hanya setelah Tahap 3 melaporkan `GO-LIVE DIIZINKAN`:

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight \
  --apply-migrations --backup-verified --acknowledge-target=production
```

Ketiga flag itu wajib ada bersamaan (`authorizeApply` di
`scripts/production-preflight.ts` menolak bila tidak, dan menolak tanpa
syarat bila salah satu dari delapan tahap read-only gagal atau terblokir —
tidak ada kombinasi flag yang mengalahkan gerbang kualitas yang gagal).
`--acknowledge-target` wajib cocok dengan `APP_ENV` **secara persis** —
ini penangkap salah-ketik yang disengaja: menjalankan perintah ini di
shell yang salah (`.env` yang salah ter-source, `APP_ENV` yang salah)
dengan nilai `--acknowledge-target` yang salah menghasilkan penolakan
keras, bukan mutasi senyap terhadap database yang salah.

## Rollback

Migrasi di repo ini hanya maju (`sql/NNN_*.sql`, tanpa migrasi `down`
berpasangan). Bila sebuah migrasi terapan perlu dibalik:

1. **Dianjurkan**: restore backup pra-apply yang ditangkap di Tahap 2 ke
   database baru, verifikasi, lalu alihkan trafiknya
   (`deploy/backup/restore-postgres.sh ... --target=<production-db>
--yes`, setelah memastikan nama targetnya memang cocok dengan yang
   dimaksud — ini `pg_restore --clean --if-exists` yang benar-benar
   destruktif, jalankan hanya terhadap database yang memang mau kamu
   timpa).
2. **Bila migrasinya aditif dan terbukti aman dibiarkan di tempatnya**
   (mis. kolom nullable baru, tabel baru yang belum dirujuk apa pun):
   biarkan perubahan skema itu terpasang dan sebagai gantinya balikkan
   kode aplikasi yang bergantung padanya, lewat rollback deploy biasa
   (artefak/image rilis sebelumnya). Pilih jalur ini hanya bila kamu sudah
   memverifikasi migrasinya tidak membuat perubahan destruktif (tidak ada
   kolom yang di-drop, tidak ada penulisan ulang data) — bila ragu,
   restore saja. Untuk data ERP secara khusus (entri buku besar yang sudah
   diposting, payroll run, pergerakan stok), utamakan restore ketimbang
   "biarkan terpasang" kapan pun ada keraguan, mengingat biaya kesalahan
   data finansial yang lebih tinggi.
3. Catat apa yang terjadi (jalur mana yang diambil, kenapa, buktinya) di
   tempat yang sama dengan tempat bukti backup Tahap 2 dicatat.

## Retensi bukti

Simpan, per apply produksi: dump backup + checksum (sesuai
`BACKUP_RETENTION_DAYS` di `deploy/backup/backup-postgres.sh`), konfirmasi
uji-restore, laporan preflight `--json-output`, dan catatan satu baris
tentang keputusan rollback bila apply itu pernah dibalik. Untuk modul
finansial/payroll ERP, retensi bukti juga wajib memperhitungkan periode
retensi statutori/pajak (lihat
[`data-lifecycle.md`](data-lifecycle.md)), bukan hanya kenyamanan
operasional.
</content>
