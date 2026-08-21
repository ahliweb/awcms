---
"awcms": patch
---

fix(blog-content): the canonical article body was stored as a jsonb string, so the public page never rendered it (#641)

Found while diagnosing a CI-only failure on #633, then verified against a real
PostgreSQL 18 rather than inferred.

Bun.SQL **JSON-encodes** a string parameter bound to a jsonb slot. So
`${JSON.stringify(x)}::jsonb` stores the jsonb **scalar string**, not the value:

```
JSON.stringify + ::jsonb  ->  jsonb_typeof = 'string'
the JS value   + ::jsonb  ->  jsonb_typeof = 'array'
```

Confirmed through the real write path, not a synthetic query:
`createBlogPost` stored `content_json` as `object` (it binds an object) and
`body_portable_text` as `string` (it bound `JSON.stringify(...)`).

### Why this was not cosmetic

ADR-0100 makes `body_portable_text` **canonical** and `content_json.blocks` a
lossy projection. #624 put the decision in one place, and it asks
`Array.isArray(body.bodyPortableText)`.

`Array.isArray` of a string is **false**. So for every post ever written through
the normal path, the public renderer took the `content_json` branch and rendered
the lossy projection — exactly the defect #624 was written to prevent, present
the whole time. Nothing errored, nothing logged, and the page looked plausible
because the projection renders *something*.

The same shape breaks anything that treats the column as jsonb rather than text:
`->`, `@>`, `jsonb_array_length`, a GIN index, a generated column.

### Eight sites, one of them the backfill itself

`blog-post-directory` (create + update), `blog-page-directory` (create +
update), `blog-revision-directory`, `direct-address-notification`
(`awcms_email_messages.variables`), `legacy-import-directory` (added hours
earlier in #599, caught by the new gate), and — the sharp one —
`portable-text-backfill`, the job whose entire purpose is to populate the
canonical column ADR-0100 introduced.

### The repo already knew, in four other files

`reconciliation-run-store.ts`, `machine-credential-directory.ts`,
`site-profile-directory.ts` and `collector.ts` each carry a comment warning about
this exact trap. Somebody hit it, wrote it down where they hit it, and eight
other call sites kept the broken spelling. **A comment in four files told four
files**, which is why this adds `bun run db:jsonb-binding:check` — it caught the
eighth site on its first run.

### `sql/141` repairs existing rows

`(body_portable_text #>> '{}')::jsonb` — `#>> '{}'` extracts a jsonb scalar's
*unquoted* text, and it is the only spelling that unwraps; `::text` gives the
quoted JSON representation and re-casting it returns the same string.

FORCE RLS is dropped for the duration and restored in the same transaction
(`sql/018`/`sql/103`/`sql/112`'s pattern): FORCE applies to the table owner too,
so a tenant-wide `UPDATE` inside a migration matches **zero rows** — green on an
empty CI database, inert on a populated one.

A shape guard restricts the cast to values that start with `[` (or `{` for email
variables), because casting an unparseable string aborts the whole migration,
which on a populated production database means the deployment stops. Anything
the guard skipped is counted and named by a `RAISE WARNING` rather than passing
silently — the same failure mode this whole issue is about.

### After deploying

`sql/141` repairs the stored **shape**. Content that has no canonical body at all
still needs `bun run blog:portable-text:backfill`, which now writes arrays.

The integration tests here fail on the pre-fix code — including the load-bearing
one, which asserts the renderer takes the canonical branch for a post that went
through the real write path rather than asserting a type.
