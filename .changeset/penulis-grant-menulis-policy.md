---
"awcms": minor
---

feat(access): setiap grant peran baru mendarat sebagai Policy — dan pencabutan mencari di KEDUA tempat

Gelombang 3 PR 3.2 dari #423, menutup unit komitmen yang dibuka
[ADR-0078](../docs/adr/0078-a-grant-carries-its-own-scope.md). Sejak PR ini
`awcms_access_policies` punya penulis produksi; tabel tanpa penulis adalah cacat
yang ADR-0077 hapus, dan PROJECT_STATE §4 mencatat 3.1 dan 3.2 sebagai satu unit
justru supaya keadaan itu tak pernah menetap.

Tiga jalur pindah: `assignRole`, penerimaan pendaftaran mandiri, dan bootstrap
tenant. `fetchGrantedPermissionKeys` membaca keduanya, jadi subjek yang diberi
grant lewat jalur baru tak bisa dibedakan dari yang lewat tabel lama.

**Ini BUKAN dual write.** ADR-0078 memilih tabel ketiga justru supaya
expand/migrate/contract tidak butuh dual write. Satu grant baru mendarat di
**satu** tabel. Menulis keduanya akan menghidupkan kembali kegagalan yang
dihindari rancangan ini: dua tulis yang bisa berhasil terpisah, meninggalkan
subjek yang memegang peran menurut satu tabel dan tidak menurut yang lain, tanpa
cara menentukan mana yang benar.

**Pencabutan harus mencari di kedua tempat.** `revokeRoleGrants` menghapus baris
lama **dan** mencabut policy aktif, karena selama backfill (PR 3.3) belum jalan
sebuah grant bisa hidup di mana saja. Penghapus yang hanya tahu tabel baru akan
melaporkan sukses sementara perannya selamat — bentuk paling berbahaya yang
tersedia di sini, karena ia gagal ke arah **AKSES TETAP ADA** dan tak ada yang
mengamatinya.

**Pemeriksaan duplikat tidak lagi gratis dari satu indeks unik**, jadi ia
ditanyakan eksplisit terhadap kedua tabel sebelum menulis. Terjemahan 23505 tetap
ada untuk satu kasus yang tersisa dan hanya itu: dua permintaan bersamaan yang
memberi peran sama, di mana salah satunya kalah di indeks unik parsial.

**Empat gerbang memerah dan tiap satunya benar:**

1. `access:grant-readers:check` menangkap penulis bersama yang baru **dan**
   entri basi untuk `self-registration.ts` yang berhenti menyebut tabel grant.
   Persis dua arah yang dirancangkan gerbang itu, di PR pertama yang menggerakkannya.
2. `modules:table-writes:check` menangkap `platform-bootstrap.ts` (milik
   `tenant_admin`) menulis tabel `identity_access`. Pengecualiannya **dipindahkan
   bersama** grant-nya alih-alih ditambahkan di sebelahnya: membiarkan tabel lama
   terdaftar setelah tak ada yang menulisnya berarti memaafkan penulis yang tak
   ada lagi.
3. `tests/access-assignment-writers.test.ts` — penanda "penulis" harus berubah
   **dua kali**: tabelnya pindah, DAN sebuah berkas kini bisa menyebabkan grant
   tanpa memuat satu pun `INSERT`. Penanda yang cuma melihat INSERT akan
   diam-diam mempersempit aturan empat-penulis menjadi dua, dan `user-admin.ts`
   — pembawa penolakan system-role utama repo ini — akan keluar dari aturannya.
4. Integrasi self-registration: helper `assignmentCount` menghitung satu tabel.
   Ia kini menghitung **union**, karena asersi di sekitarnya bertanya "apakah
   orang ini diberi grant", bukan "berapa baris di tabel ini" — dan salah satu
   asersinya adalah asersi keamanan ("peran sistem ditolak, dan penerimaan tidak
   menulis apa pun"), yang akan melaporkan nol untuk grant yang ada.

`platform-bootstrap.ts` menulis INSERT-nya **inline** alih-alih memanggil penulis
bersama: `tenant_admin` tidak boleh mengimpor kode aplikasi `identity_access` —
DAG modul berjalan ke arah sebaliknya dan `modules:dag:check` menegakkannya.
Duplikasinya dua INSERT dan dipatok test penulis di atas.

Setiap grant yang ditulis hari ini **tenant-wide**. Scope yang lebih sempit bisa
ditulis ketika PR 3.4 mengajari evaluasi mengualifikasinya — mengirimkan penulis
untuk scope yang masih diabaikan evaluator berarti membagikan grant yang
**terlihat sempit dan tidak**.
