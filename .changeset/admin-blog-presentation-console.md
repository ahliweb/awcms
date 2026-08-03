---
"awcms": minor
---

`/admin/blog-presentation` — templates, menus, widgets and theme, the fourth
blog console.

Four activities on one screen because they answer one question (how the blog
looks) and each is a short bounded list. `?section=` reads only the section
being shown, and a section the operator cannot read is not offered at all.

The eight permissions are gated as four INDEPENDENT pairs: holding
`widgets.configure` must not reveal a template control.

Three deliberate absences, each mutation-proven:

- **menu ITEMS are not editable.** `PATCH /api/v1/blog/menus/{id}` replaces the
  whole item list, so a flat form would delete every item it did not render.
  The client never sends the key at all;
- **no "revert to tenant default" for the theme.** `upsertBlogThemeSettings`
  only INSERTs or UPDATEs and no delete route exists, so an override is
  one-way. The screen states that instead of offering a control that cannot
  succeed;
- **no bin, no Restore.** Templates, menus and widgets all soft-delete with no
  counterpart and no `*.restore` permission to build one against.

`key` is sent on create and never on update, because the update inputs have no
`key` field.
