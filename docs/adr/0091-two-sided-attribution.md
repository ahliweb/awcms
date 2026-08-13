# ADR-0091 — Atribusi dua sisi, dan catatan kelahiran yang akhirnya bisa ditulis

- **Status:** Diterima (2026-08-13).
- **Konteks:** Issue #423 Gelombang 8 PR 8.3. Migrasi `sql/118`.
- **Membangun di atas:**
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) (aktor
  terdelegasi adalah tenant user sungguhan — yang membuat setiap catatan
  tentangnya terlihat seperti catatan tentang karyawan),
  [ADR-0054](0054-tenant-provisioning.md) (tindak lanjut terbuka yang ditutup di
  sini), dan [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (decision log adalah
  tabel terbesar di repo ini — apa pun yang ditambahkan padanya harus
  membayar sewanya).

## Masalah yang dibuat ADR-0090

Keputusan ADR-0090 yang membuat segalanya bekerja tanpa perubahan — **aktor
terdelegasi adalah tenant user sungguhan** — juga membuat satu hal berhenti
bekerja: catatannya tidak bisa dibedakan.

`actor_tenant_user_id` pada baris audit menunjuk baris keanggotaan yang
sempurna biasa di tenant C. Tidak ada apa pun padanya yang mengatakan orang di
baliknya bekerja untuk tenant X. Pertanyaan **"apa saja yang dilakukan vendor
kami di dalam sistem kami"** karena itu tidak punya query — setiap barisnya
tampak seperti baris karyawan.

## Keputusan

Tiga kolom, dan masing-masing menjawab satu pertanyaan:

| Kolom                                         | Menjawab                              |
| --------------------------------------------- | ------------------------------------- |
| `awcms_audit_events.actor_tenant_id`          | aktornya dari tenant mana             |
| `awcms_audit_events.delegated_grant_id`       | grant mana yang membuatnya bisa       |
| `awcms_abac_decision_logs.delegated_grant_id` | sama, pada setiap keputusan otorisasi |

## NULL berarti "dari dalam", bukan "tidak diketahui"

`actor_tenant_id` **tidak** ditulis pada setiap baris. Menuliskannya akan
menduplikasi `tenant_id` pada 99,9% baris, dan kolom yang hampir selalu sama
dengan tetangganya berhenti dibaca — yang justru saat itulah satu baris tempat
ia berbeda lewat tanpa terlihat.

Bentuknya bukan penemuan baru: `awcms_tenant_status_transitions.actor_tenant_id`
(`sql/092`) sudah memakainya sejak ADR-0054. PR ini memakai bentuk yang sudah
ada alih-alih menciptakan yang kedua.

Konsekuensi yang dinyatakan: **tidak ada backfill.** Baris yang sudah ada
ditulis sebelum akses terdelegasi ada, jadi NULL pada semuanya sudah benar.
Mengisinya dengan `tenant_id` akan mengubah setiap baris lama menjadi klaim yang
kebetulan benar dan menghapus perbedaan yang menjadi seluruh guna kolom ini.

## FK-nya komposit, dan itu bukan gaya

`(tenant_id, delegated_grant_id)` → `awcms_delegated_access_grants
(tenant_id, id)`. FK sederhana pada `id` saja **melewati RLS**, seperti setiap
FK, dan akan menerima id grant milik tenant lain — sebuah baris audit yang
menyebut grant yang tidak pernah menjangkau tenant ini. Tuntutan yang sama
menghasilkan FK komposit office di #149.

CHECK pasangannya menutup setengah-jawaban: sebuah baris tidak boleh menyebut
grant tanpa menyebut tenant asalnya.

## Decision log TIDAK mendapat `actor_tenant_id`

Ia hanya mendapat `delegated_grant_id`, dan penghematan itu disengaja.

Baris decision log ditulis chokepoint pada jalur panas **setiap request** —
tabel terbesar di repo ini (ADR-0072). Tenant asal dapat diturunkan dari
grant-nya lewat satu join yang hanya dijalankan investigasi. Menyimpan keduanya
berarti menulis dua kolom per request untuk menghindari satu join yang
dijalankan beberapa kali setahun.

Alasan yang sama membuat index-nya **parsial**: kolomnya NULL pada hampir setiap
baris, dan index penuh atasnya adalah biaya tanpa pembaca.

## Grant-nya diresolusi dengan query KEDUA, bukan join

`resolveDelegatedGrantId` berjalan hanya bila `principal_kind = 'delegated'`.

Menjoinkan tabel grant ke query autentikasi akan membuat **setiap request
biasa** membayar index probe supaya request yang jarang bisa menghemat satu
round trip. Biayanya mendarat di tempat yang salah.

Resolusinya juga **fail-quiet**, dan itu aman justru karena sifat kolomnya: id
grant adalah **atribusi, bukan input otorisasi**. Tidak ada yang diizinkan atau
ditolak karenanya, jadi yang hilang bila ia tidak ketemu adalah satu kolom pada
baris audit — tidak pernah sebuah keputusan.

## Catatan kelahiran yang akhirnya bisa ditulis

ADR-0054 meninggalkan satu tindak lanjut terbuka:

> baris audit provisioning mendarat di log tenant platform, yang benar, tetapi
> **tenant yang dibuat tidak melihat catatan kelahirannya sendiri.**

Ia terbuka karena **tampak mustahil**, dan tampak mustahil karena alasan yang
benar: `awcms_audit_events` FORCE RLS, jadi tenant platform tidak bisa
menyisipkan baris ber-`tenant_id` tenant lain. Dinding yang sama menjatuhkan
rencana ADR-0087 dan ADR-0088.

Yang membuatnya bisa di sini adalah sesuatu yang sudah ada dan tidak diperhatikan
siapa pun: `createTenantWithOwner` **sudah berdiri di dalam konteks tenant
baru** — ia melakukan `SET LOCAL app.current_tenant_id` di awal dan
memulihkannya di akhir. Catatan kelahirannya ditulis dari DALAM, di jendela yang
sudah ada, tanpa satu pun penulisan lintas-tenant.

Itu juga alasan temuan ini masuk ADR alih-alih menjadi satu commit diam-diam:
tiga PR berturut-turut menyimpulkan "tidak bisa dilakukan" dari premis yang
benar, dan yang membedakan kasus ini bukan aturan baru melainkan **di mana kode
itu kebetulan berdiri**. Orang berikutnya yang membaca "tidak bisa menulis
lintas tenant" harus juga membaca kalimat ini.

**`actor_tenant_user_id` sengaja tidak ikut menyeberang.** `actor_tenant_id`
memberi pelanggan fakta yang mereka butuhkan — tenant ini dibuat oleh platform.
Id operator perseorangan adalah uuid buram yang tidak bisa mereka resolusi (RLS
menghalangi mereka membaca `awcms_tenant_users` platform) sekaligus tetap
sebuah identifier yang diserahkan ke pihak ketiga. Ia tinggal di baris sisi
platform, tempat ia bisa diresolusi.

## Konsekuensi

- Pertanyaan "apa saja yang dilakukan orang luar di tenant saya" menjadi satu
  query ber-index atas `awcms_audit_events (tenant_id, actor_tenant_id,
created_at DESC)`.
- Pertanyaan "apa saja yang terjadi di bawah grant ini" menjadi satu query, dan
  ia menjangkau **kedua** tabel — tindakannya dan setiap keputusan otorisasi
  yang mendahuluinya.
- Tenant yang baru dibuat kini punya tepat satu baris audit `create` di lognya
  sendiri, ber-`actor_tenant_id` platform. Tindak lanjut ADR-0054 **tertutup**.
- Kolom-kolom ini mendarat **inert bagi setiap deployment yang belum memakai
  akses terdelegasi**: NULL di mana-mana, tidak ada perilaku yang berubah, dan
  satu baris baru saat provisioning.

## Ditolak

- **Backfill `actor_tenant_id = tenant_id`** untuk baris lama.
- **`actor_tenant_id` pada decision log** — dua kolom per request untuk
  menghindari satu join investigasi.
- **Index penuh** atas kolom yang hampir selalu NULL.
- **Join tabel grant ke query autentikasi** — biaya pada setiap request biasa
  demi request yang jarang.
- **Membawa `actor_tenant_user_id` platform ke dalam log pelanggan.**
- **Menjadikan id grant input otorisasi.** Ia atribusi; membuat sebuah keputusan
  bergantung padanya akan mengubah kegagalan resolusi yang tidak berbahaya
  menjadi kegagalan akses.
