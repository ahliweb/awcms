---
"awcms": minor
---

feat(blog-content): a legacy archive can keep its photographs (#599)

`bun run blog:legacy:import` landed in #640 and, on a real CKEditor archive,
would have refused very nearly every row.

`convertLegacyHtmlToPortableText` rejects `<img>` — correctly, because a
managed-media deployment stores images as registry references and an import that
kept the raw `src` would smuggle unmanaged media past the enforcement
`media_library` exists to apply. The rejection names the `src` "so the importer
can resolve it to an uploaded object first". Nothing implemented *first*. For
23,906 articles that meant a refusal log with ~24,000 entries and zero imported
posts.

### What was NOT built, and why that is the same answer as last time

Not a fetcher. Turning a legacy URL into a managed object means pulling
third-party bytes from the server at an address somebody else chose — a
server-side request forgery primitive — and then minting a `verified` registry
row for bytes no upload pipeline ever inspected. `legacy-ad-ingest.ts` faced
exactly this question for `awcms_blog_ads.image_url` and wrote the answer down
at length: bytes are vouched for by the upload pipeline or not at all. That
reasoning is unchanged by the volume.

### What was built: the other half of the handoff

- **`--images=<path>`** writes the upload set — every distinct `<img src>` the
  archive references, counted by ARTICLE and ordered by demand — and stops
  there. It is built from the converter's own findings rather than a second scan
  of the HTML, so there is one definition of "what counts as an image
  reference".
- **`--media-map=<path>`** takes the result back as `{ "<src>": "<uuid>" }`
  after the operator has uploaded the files through `/admin/media`. A mapped
  image becomes a one-item `gallery` node **in the position it occupied in the
  article**; consecutive images join one gallery, which is the common CKEditor
  photo-row shape.

Without `--media-map` nothing changes: `<img>` is residue exactly as before, and
an image the map does not cover still refuses its article rather than importing
it with a hole.

### The check that has to happen before anything is written

Every id in the map is put to the registry — `isMediaReferenceSafe`, so
"exists, belongs to this tenant, and is verified/attached" — and one that fails
aborts the whole run.

That is deliberate rather than defensive. `renderGalleryBlockHtml` silently
drops a gallery item whose media object does not resolve, because a public page
must degrade rather than 500. So a wrong id produces an article that imported
cleanly, reported no error, and has lost its photographs — visible only to a
reader, on a page nobody re-checks. It cannot be a per-row refusal either: a map
is one artefact, and a wrong id in it is a wrong artefact. The cross-tenant and
not-yet-verified cases are tested against real Postgres, because "is this a
uuid" and "is this our verified media" are different questions and only the
second one is the right one.

### One thing deliberately not carried across

No `caption`. The renderer prints `caption` as a visible `<figcaption>` (and
reuses it as the `alt`), while a legacy `alt` is very often the file name.
Carrying it would print a filename under 23,906 photographs — a silent edit to
every article in the archive, made by an import script.
