---
"awcms": patch
---

docs(sample-content): nine finished articles so a fresh deployment has something to render

A CMS with no content answers none of the questions you set it up to answer:
every list is empty, every pagination boundary is untested, and every layout
looks correct because nothing is in it. `data/sample-content/` now carries nine
finished articles in Bahasa Indonesia — choosing a CMS, perceived page speed, URL
structure that never has to change, the three services, Core Web Vitals for
non-technical owners, static versus dynamic, and a pre-launch checklist.

No new code and no new importer: the archive is NDJSON in the shape
`bun run blog:legacy:import` already reads, so preview stays the default and a
re-run is a no-op on the existing unique key.

`--system=sample-ahliweb` is load-bearing rather than cosmetic. The redirect
importer decides which rows to derive a 301 map from by system name, so a
distinct one is what stops a real migration run building redirects for URLs that
never existed on anybody's site.

Verified by importing into a migrated database rather than by reading: 9 of 9
importable, 0 refused, 9 inserted, each with a real Portable Text body of 8-16
blocks and a derived `content_text`.
