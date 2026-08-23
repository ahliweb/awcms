🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0110-a-video-embed-origin-is-an-operators-decision.md)

<!-- i18n-source-hash: sha256:a766cc9df2a86f3dc31b2bfc6d677843203a9a77a601965cc50e56224d3bace9 -->

# ADR-0110 — Origin embed video adalah keputusan OPERATOR, bukan keputusan tenant

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #597 butir 8; Issue #639 (blok `video_news` dan renderer-nya); Issue #148 / #186 (CSP dan satu-satunya origin opt-in yang sudah ada); ADR-0025 (profil deployment)

## Konteks

`_shared/rendering/video-news-block-renderer.ts` sudah membangun iframe `youtube-nocookie.com` yang benar dan privacy-enhanced sejak Issue #639: markup tetap, provider dan video id divalidasi saat tulis, tidak ada jalur yang bisa merender HTML kiriman pemanggil.

**Setiap iframe itu selalu diblokir peramban.** CSP repo ini tidak memasukkan origin pihak ketiga mana pun ke allow-list, jadi `frame-src` hanya menyebut `challenges.cloudflare.com`, dan hanya ketika Turnstile menyala. Header renderer itu sendiri menyatakan akibatnya dengan tepat — _"degradasi senyap dan aman (tidak ada video, tidak ada galat konsol yang dilihat pengguna, tidak ada XSS)"_ — dan menyebut perbaikan yang ditunggunya: _"flag opt-in di masa depan yang meniru pola Turnstile"_.

Yang dialami editor adalah area kosong di tempat video seharusnya, tanpa apa pun yang menjelaskannya. Issue #597 butir 8 menyebut ini keputusan CSP dengan konsekuensi keamanan dan meminta ADR, dan itu tepat: batasan yang dihormati port #639 adalah sebuah jaminan, bukan kelalaian.

## Keputusan

**`BLOG_VIDEO_EMBED_ENABLED=true` menambahkan tepat satu origin — `https://www.youtube-nocookie.com` — ke `frame-src`, dan tidak ada yang lain. Bila tidak diset (bawaan), kebijakannya sama persis bita demi bita dengan sebelumnya.**

Polanya adalah pola Turnstile, satu-satunya preseden yang ada untuk memasukkan origin pihak ketiga, dan kedua sakelar itu independen: salah satu, keduanya, atau tidak sama sekali, dengan `frame-src` menyebut persis origin yang menyala.

### Tidak diturunkan dari data tenant, dan itulah muatan keamanan ADR ini

Alternatif yang menggoda adalah "izinkan origin-nya ketika sebuah tenant mengaktifkan blok `video_news`". Header CSP bersifat per-RESPONS dan berlaku se-deployment: satu tenant yang mengaktifkan video akan membuka origin itu untuk **setiap** tenant yang berbagi deployment, dan jaminan yang ditegakkan `tests/security-headers-csp.test.ts` akan bergantung pada DATA, bukan pada keputusan operator.

Jaminan yang bisa dibalik oleh satu baris di tenant orang lain bukanlah jaminan. Maka sakelarnya berada di tempat deployment dikonfigurasi, dan operatorlah yang memutuskan bahwa deployment ini berbicara dengan YouTube.

### Tidak digerbangi profil keamanan online

`isTurnstileRequired` adalah `isFullOnlineSecurityActive(env) && flag`, karena Turnstile melakukan panggilan keluar ke Cloudflare dan tak bermakna tanpanya. Embed video **tidak melakukan panggilan sisi-server sama sekali** — peramban pembacalah yang mengambilnya — jadi ini flag saja. Operator yang menjalankan deployment LAN dan menyetelnya sudah membuat persis pilihan yang diminta jaminan itu, dan gerbang kedua hanya akan menghalanginya melihat pratinjau halaman saat pengembangan.

### Hanya `frame-src`; bukan `script-src`

Embed-nya adalah iframe. Turnstile membutuhkan `script-src` juga karena widget-nya memuat skrip ke dalam halaman kita; blok video tidak pernah begitu, dan melebarkan `script-src` untuknya berarti memberikan kapabilitas yang jelas lebih berbahaya demi tidak mendapat apa-apa.

### Origin-nya punya satu definisi

`lib/security/video-embed.ts` mengekspornya, dan RENDERER mengimpor basis embed-nya dari sana. Dua salinan string itu adalah susunan di mana kebijakan dan markup menyimpang, dan mode kegagalannya adalah iframe yang diblokir kebijakan yang mengaku mengizinkannya.

### Yang tetap tertutup

`frame-ancestors 'none'` dan `X-Frame-Options: DENY` tidak disentuh. Membuka `frame-src` menyatakan apa yang boleh DIsematkan halaman ini; ia tidak menyatakan apa pun tentang siapa yang boleh menyematkan halaman ini, dan keduanya mudah tertukar.

## Konsekuensi

- **Positif:** Issue #597 butir 8 tertutup, dan blok `video_news` yang ditempatkan editor benar-benar berputar untuk pembaca di deployment yang memintanya.
- **Positif:** jaminan LAN/offline utuh dan kini mencakup dua sakelar alih-alih satu, dengan tesnya menegaskan bahwa tidak ada yang membocorkan origin yang lain.
- **Negatif / kompromi:** deployment yang menyalakannya memberi tahu YouTube halaman mana yang dibuka pembaca. `youtube-nocookie.com` membatasi apa yang DISIMPAN sebelum pemutaran, bukan apa yang diminta — pernyataan jujurnya adalah "lebih sedikit cookie", bukan "tanpa pihak ketiga".
- **Negatif / kompromi:** sakelarnya berlaku se-deployment, jadi deployment multi-tenant tidak bisa mengizinkan satu ruang redaksi memakai video dan melarang yang lain. Itu ongkos langsung dari tidak membiarkan data tenant mengubah header keamanan, dan itu sisi yang benar untuk keliru.
- **Netral:** deployment yang membiarkannya tidak diset mempertahankan perilaku hari ini persis, termasuk area kosongnya. Komentar renderer kini menyatakannya dalam bentuk kini, bukan menggambarkan keterbatasan yang menunggu perbaikan.

## Alternatif yang dipertimbangkan

- **Memasukkan origin-nya ke allow-list tanpa syarat** (yang dilakukan awcms-mini). Ditolak — ia merusak jaminan "tanpa origin pihak ketiga kecuali operator memilihnya" untuk setiap deployment, termasuk yang tidak akan pernah menempatkan blok video. Ini opsi yang sudah ditolak port #639, dengan alasan ini.
- **Menurunkannya dari tipe blok yang diaktifkan tenant.** Ditolak — lihat di atas. Ia menjadikan header keamanan se-deployment sebagai fungsi dari data satu tenant.
- **Menutup fiturnya: hapus renderer dan tipe bloknya.** Ditolak. Renderer-nya benar, bloknya divalidasi saat tulis, dan ruang redaksi tanpa video adalah kehilangan nyata; bagian yang kurang adalah satu baris kebijakan, bukan fiturnya.
- **CSP per-tenant.** Tidak ditolak atas dasar mutu; di luar lingkup. Ia berarti kebijakan sebuah respons bergantung pada tenant yang teresolusi, yaitu perubahan pada cara setiap header di repo ini dibangun, demi satu direktif.
