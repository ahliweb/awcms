---
"awcms": patch
---

Perbaiki dua diagram mermaid yang gagal di-render GitHub, dan gerbangi kelas
cacatnya di `check:docs`.

Saat parse gagal, GitHub tidak merender sebagian — ia mengganti **seluruh**
diagram dengan kotak "Unable to render rich display". Dua diagram di repo ini
gagal parse sementara `bun run check` tetap hijau, karena `checkMermaid` hanya
memvalidasi pagar blok dan tipe diagram, tak pernah isinya.

Grammar flowchart mermaid memperlakukan `(` sebagai token pembuka bentuk node,
jadi kurung di posisi TEKS mematikan diagram:

- `README.md`/`README.id.md` — label SISI `-->|online (primary)|`, yang dilihat
  langsung di halaman depan GitHub;
- `docs/awcms/21_module_admission_governance.md` — empat label NODE rhombus
  (`Q2{... (bukan fitur produk berdiri sendiri)?}` dst.). Diagram ini rusak
  diam-diam dan tak pernah dilaporkan.

Perbaikannya sama untuk keduanya: kutip labelnya. Bentuk silinder `[( )]` di
README TIDAK diubah — di sana kurung adalah sintaks bentuk, bukan teks.

Gerbangnya diperluas: untuk blok `flowchart`/`graph`, setiap `(`/`)` yang
tersisa setelah teks ber-kutip dan pembatas bentuk (`[( )]`, `([ ])`, `(( ))`,
`[[ ]]`, `{{ }}`) dibuang = temuan, dengan pesan yang menyebut perbaikannya.
Aturan ini sengaja TIDAK berlaku untuk `sequenceDiagram` dkk., tempat kurung
dalam teks memang sah.

Setiap klaim di atas diverifikasi terhadap parser mermaid 11 NYATA — engine yang
sama dengan yang dipakai GitHub — bukan disimpulkan dari dokumentasi: tanpa
kutip GAGAL, dengan kutip LOLOS, bentuk ber-kurung LOLOS apa adanya, dan kurung
di `sequenceDiagram` LOLOS. Sesudah perbaikan, 85 blok mermaid di seluruh
markdown ter-track di-parse dengan nol rusak, dan gerbangnya menandai tepat lima
baris cacat itu — nol temuan palsu di 85 blok tersebut.

Cakupan gerbang dinyatakan terbuka di kode: ini pemeriksa sintaksis satu kelas
cacat, bukan parser mermaid.
