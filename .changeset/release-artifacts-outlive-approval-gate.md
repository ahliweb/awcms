---
"awcms": patch
---

Artefak rilis bertahan lebih lama dari gerbang persetujuan yang menunggunya

`release.yml` mengunggah SBOM, tarball sumber, dan checksum dengan `retention-days: 1`, lalu menggantung job penerbitan di balik gerbang environment `release` yang **tidak punya batas waktu sama sekali**. Setiap persetujuan yang datang lebih dari 24 jam setelah build karena itu menerbitkan apa-apa: artefaknya sudah hilang.

Itu bukan skenario teoretis. Run v7.0.0 mati persis begitu — build selesai 5 Agustus 08:43 UTC, artefaknya kedaluwarsa 24 jam kemudian, dan persetujuan yang tiba 8 Agustus langsung menabrak `Artifact not found for name: release-artifacts`. Yang membuatnya mahal: tidak ada satu pun kalimat di teks kegagalan yang menyebut retensi, jadi kegagalannya terbaca seperti masalah unggah, bukan seperti run yang sudah tidak mungkin diterbitkan sejak dua hari sebelumnya. Rilis itu menggantung 63 jam sebelum ada yang menyentuhnya, dan pada jam ke-24 ia sebenarnya sudah mati.

Retensi dinaikkan ke 30 hari — sama dengan batas GitHub sendiri untuk berapa lama sebuah run boleh menunggu persetujuan. Dengan begitu setiap gerbang yang masih bisa disetujui punya artefak untuk disetujui, dan kedua batas itu berhenti saling bertentangan.

`ci.yml` memakai `retention-days: 5` dan tidak diubah: tidak ada job di sana yang menunggu di balik gerbang, jadi retensinya tidak pernah berlomba dengan keputusan manusia.
