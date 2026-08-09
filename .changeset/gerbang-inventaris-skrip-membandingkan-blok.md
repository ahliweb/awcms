---
"awcms": patch
---

`scripts:inventory:check` membandingkan SELURUH blok ter-generate, bukan hanya
baris tabelnya (#442).

`renderInventory()` menulis dua hal: kalimat hitungan dan tabel. Pemeriksanya
memanggil `parseInventoryBlock()`, yang menyaring `line.startsWith("| \`")` —
jadi kalimat di atas tabel dihasilkan lalu tidak pernah dibandingkan dengan
apa pun. `main` hari ini berbunyi "78 target … 32 di antaranya" sementara
tabelnya memuat 79 baris dan kebenarannya 79/33.

Yang membuat ini layak diperbaiki bukan angkanya, melainkan **siapa yang
menuliskannya**: git, bukan manusia. #435 dan #440 lahir dari base yang sama,
masing-masing menambah satu target, jadi keduanya mengubah baris kalimat itu
menjadi teks yang IDENTIK. Rebase yang kedua di atas yang pertama tidak
menemukan konflik pada baris yang kedua sisinya sama, menggabungkan baris
tabel yang berbeda dengan benar, dan menghasilkan blok yang separuhnya benar
— nol konflik, nol gerbang merah.

Arah itulah temuannya: pemeriksa lama meliputi tepat bagian yang git TIDAK
BISA salah gabung dan melewatkan bagian yang BISA. Karena itu unit
pembandingnya kini blok, dinormalisasi hanya terhadap apa yang prettier
tulis ulang (padding kolom + garis pemisah) — sehingga apa pun yang
generatornya diajari tulis berikutnya ikut tercakup tanpa ada yang perlu
mengingatnya.

Buktinya bukan test yang ditulis untuk hijau: gerbang yang sudah diperbaiki
dijalankan terhadap `main` apa adanya dan MERAH pada cacat yang benar-benar
ada di sana, lalu hijau setelah regenerasi. Nol perubahan runtime.
