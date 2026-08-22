---
"awcms": patch
---

fix(api): the menu and widget lists were documented as returning "object"

`GET /api/v1/blog/menus` and `GET /api/v1/blog/widgets` each declared their
payload as an array of bare `object`. That is not a wrong shape — it is **no
shape**, and it is worse than a wrong one in a specific way: nothing can ever
fail against it. Any field could be renamed or dropped and the frozen consumer
contract would still pass, because everything is a subset of "object".

Issue #597 item 6 says menus and widgets are configurable and nothing renders
them. The reason no consumer could is that there was nothing to build against:
`awcms-astro`'s contract gate freezes response shapes, and freezing this one
would have frozen a promise with no content.

So `BlogMenu` and `BlogWidget` are written out, and three things the code
already does are now stated rather than left to be discovered:

- **A menu carries its `items`**, already sorted by `sortOrder`. That is what
  the schema exists for — a menu without items is a name, and navigation cannot
  be rendered from a name.
- **`key` is the identifier, `name` is the label.** A consumer that selects a
  menu by `name` breaks the first time somebody fixes a typo.
- **Inactive widgets ARE returned.** There is no `?activeOnly=`; `isActive` is
  on every row and the consumer filters. An endpoint that hid them would make
  "switched off" and "deleted" the same answer.
- **`bodyText` is plain text, not markup.** The write path refuses unsafe HTML
  rather than sanitizing it, so a consumer must escape before rendering.

`BlogMenuItem` gains `tenantId` and `menuId` as `readOnly` — the read returns
them and the write does not accept them, and the schema is shared by both.

Writing a schema creates a new way to be wrong: naming a field the endpoint does
not return. This repo shipped that once already — the post list documented as
`BlogPost` while it returned a summary, which built an entire site of empty
articles with nothing failing. So
`tests/integration/menu-widget-response-shape.integration.test.ts` reads the
`required` list out of the BUNDLED spec, seeds real rows, calls the same
functions the routes call, and requires every one of those properties to be
present on what comes back. The document cannot claim a field the code does not
produce.
