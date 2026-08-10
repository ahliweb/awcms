---
"awcms": patch
---

fix(identity-access): sensus principal menjawab kategori ketiganya — dan berhenti mengklaim sesuatu yang salah

`bun run identity:principals:preflight` adalah langkah pertama #430 dan
prasyarat Gelombang 7. Ia menghitung dua dari tiga kategori yang diminta
issue-nya: tabrakan di dalam satu tenant, dan identifier yang bukan email.
Kategori ketiga — **identitas yang tidak bisa dikirimi surat** — hilang.

Yang lebih penting: docblock-nya **mengklaim** kategori kedua sudah menjawab
kategori ketiga, dengan kalimat *"ia tidak akan pernah bisa menerima undangan
maupun reset password"*. Itu **tidak benar**.

Kedua predikatnya berbeda, dan berbeda di **dua arah**:

- `looksLikeEmail` (sensus) menuntut titik di domain dan menolak spasi;
- `isMailableLoginIdentifier` (yang benar-benar dipakai jalur reset password)
  hanya menuntut `@` dengan bagian kiri dan kanan tak kosong.

Jadi `a@localhost` **bukan email** menurut sensus tetapi **bisa dikirimi surat**
menurut kode yang mengirimnya — dan sensus melaporkan satu himpunan sambil
menjelaskan himpunan lain. Itulah cara sebuah sensus menyesatkan migrasi yang ia
ada untuk menurunkan risikonya.

Perbaikannya **mengimpor** `isMailableLoginIdentifier`, bukan menyalin bentuknya.
Ejaan kedua untuk "bisa dikirimi surat apa tidak" adalah kelas cacat yang sudah
mahal di repo ini: sensus melaporkan satu himpunan, kode pengirim bertindak atas
himpunan lain, dan keduanya terlihat benar bila dilihat sendiri-sendiri.

Dibuktikan **merah** dengan mengganti impor itu kembali menjadi salinan:
`a@localhost` adalah kasus yang membedakan keduanya, dan tanpa impornya test itu
gagal.

Kedua temuan tetap **advisory** — `clear` tetap terikat hanya pada tabrakan
di dalam satu tenant. Sebuah advisory yang memblokir akan mengubah sensus
menjadi gerbang, dan sensus yang menolak selesai tidak memberi tahu apa pun
tentang sisa estate-nya.

Tidak menutup #430: itu soal **keying**, dan perbaikannya principal global di
Gelombang 7. Ini melengkapi langkah read-only yang issue-nya sebut sebagai
miliknya.
