---
"awcms": patch
---

fix(gerbang,docs): skill dan README modul berhenti menamai layar admin yang tak ada — dan satu keputusan yang bersandar pada layar fiktif dikoreksi

`skills:check` menggerbangi path `src/…`, ADR, dan target `bun run` — tetapi
**bukan** klaim yang paling sering dipakai pembaca untuk bertindak. Sebuah skill
jarang menulis "`src/pages/admin/site-search.astro` ada"; ia menulis "layarnya
`/admin/search`". Aturan **5** menutup itu: tiap URL `/admin/…` yang dikutip
wajib resolve ke halaman nyata.

Empat klaim yang sudah ter-ship, masing-masing gagal ke arah yang memakan waktu
orang:

- **`awcms-site-search`** mendaftar `/admin/search` di bawah judul
  "**Yang BELUM ada (jangan klaim ada)**" — padahal `src/pages/admin/site-search.astro`
  sudah mendarat. Salah dua kali: layarnya ada, dan alamatnya bukan itu. Skill
  DIIKUTI, jadi ini menyuruh agen membangun ulang layar yang sudah bekerja.
- **`awcms-blog-content`** menyatakan `/admin/blog/widgets` dan `/admin/blog/ads`
  "sudah ada sejak #543". Direktori `src/pages/admin/blog/` **tak pernah ada**;
  widget hidup di `/admin/blog-presentation?section=widgets`, dan **iklan tidak
  punya layar sama sekali**.
- **README `blog_content`** memuat peta 14 baris `/admin/blog/*` yang **satu**
  entri-nya resolve. Blok itu sebenarnya sudah berlabel "(spesifikasi mini)"
  dengan peringatan di atasnya — label yang bisa dibaca manusia dan tak terlihat
  gerbang, jadi ia kini ditandai `<!-- aspirational:mulai -->`.
- **README `reporting`/`workflow-approval`** memuat paragraf yang justru
  MENGOREKSI (`/admin/reporting/projections` dan `/admin/workflows` "never
  existed here"). Kalimat semacam itu harus boleh menyebut path-nya, jadi ia
  dipagari `<!-- historis:mulai -->` — konvensi yang sama yang
  `tests/url-vocabulary-split.test.ts` pakai.

**Korpusnya mencakup `src/modules/<nama>/README.md`, dan itulah intinya.** README
modul lebih otoritatif daripada skill bagi siapa pun yang menyentuh modul itu,
dan ia tidak digerbangi sebagaimana descriptor digerbangi — asimetri yang sama
yang `tests/module-absence-claims.test.ts` harus tutup untuk klaim-absen.
Membatasi aturan ini ke `.claude/skills` berarti menggerbangi turunannya dan
membiarkan sumbernya.

**Temuan yang lebih besar dari rot dokumen, ditemukan sambil mengerjakan ini.**
Tiga tempat menyatakan layar `/admin/modules/blog_content` "sudah ada", dan satu
di antaranya memakai klaim itu untuk **membenarkan sebuah keputusan**: "visual
settings editor … sengaja tidak dibangun; layar generik (Module Management,
sudah ada) cukup". Diverifikasi: `src/pages/admin/modules.astro` hanya mendaftar
modul dan menyalakan/mematikannya — **nol editor setting**, dan tak ada rute
`/admin/modules/{key}`. Sementara itu `GET`/`PATCH
/api/v1/tenant/modules/{moduleKey}/settings` **ada dan ter-guard**. Jadi setiap
setting modul di repo ini — bukan hanya milik `blog_content` — hari ini hanya
bisa diubah lewat `curl`, dan alasan tertulis untuk tidak membangun editornya
bersandar pada layar yang tak pernah ada. Teksnya dikoreksi; **layarnya sendiri
adalah gap permukaan kelas ADR-0051 yang berdiri sendiri** dan tidak dikerjakan
di sini.

Detail aturannya:

- Path ber-`...`, `*`, atau segmen `{param}`/`[param]` dilewati — itu pola,
  bukan alamat. Query string dan fragment dipotong, karena
  `/admin/blog-presentation?section=widgets` adalah alamat nyata.
- **Token awal-baris ikut dibaca**, bukan hanya yang berbacktick: peta rute
  hidup di blok berpagar, dan instans terburuk dari cacat ini justru satu
  blok ```txt yang tak satu pun entri-nya berbacktick.
- Skill aspirational dikecualikan dengan alasan yang sama seperti aturan 1:
  subjeknya tidak ada, jadi layarnya juga tidak.
- Korpus kosong **memerahkan** gerbang alih-alih lolos hampa.

**Mutation-proven empat arah:** cacat asli `awcms-site-search` → MERAH; pagar
aspirational dilepas dari peta spesifikasi mini → MERAH; glob korpus diarahkan
ke nama yang tak ada → MERAH ("would pass vacuously"); layar palsu ditanam di
README modul lain → MERAH menyebut berkas dan path-nya.
