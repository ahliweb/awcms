---
"awcms": patch
---

chore(deps-dev): bump prettier-plugin-astro from 0.14.1 to 1.1.0, with a full deliberate reformat

Dev-only formatter plugin behind `bun run lint`/`bun run format`'s `.astro` handling. `1.0.0`
is a full rewrite of the plugin on top of Astro 7's Rust compiler (new whitespace-handling
engine, `astroCompressHTML`/`astroAllowShorthand` options added); this repo sets neither
option, so attributes are left exactly as written and no shorthand rewriting occurred.

This PR was left open deliberately (see the earlier close-out of #850) until the reformat
could be reviewed rather than blindly accepted, because a formatter rewrite CAN change
rendered HTML (trailing/leading whitespace around inline elements, `set:html`/script/style
block handling). The review method used here is the strongest available: build the SSR
server bundle before and after running `bun run format` with the new plugin, from the exact
same working directory, and diff the compiled output.

Of 743 compiled server chunks, exactly 5 changed content (out of 76 reformatted `.astro`
source files) — every other page/component compiled to byte-identical output despite its
source being reformatted, and `dist/client` was untouched. The 5 real differences:

- 4 pages (`blog-pages`, `blog-presentation`, `form-drafts`, `reporting`) gained a trailing
  `"\n  "` text node inside a `<Fragment slot="page-description">`, immediately before the
  slot's closing tag, because the old plugin split the closing tag itself across the line
  break (`</a>.</Fragment\n  >`, invisible to the parser) while the new plugin puts the
  closing tag on its own line (`</a>.\n  </Fragment>`, a real trailing text node). Verified
  safe: every `page-description` slot is consumed by `AdminLayout.astro` inside
  `<p class="admin-page-description">`, whose CSS (`admin.css`) uses default
  `white-space: normal` — trailing whitespace at the end of inline content in a block box is
  collapsed away by the browser, so nothing renders differently.
- 1 page (`src/pages/index.astro`, the public homepage) replaced a literal space character
  that survived an old-style tag-splitting line break (`tersedia dari <a\n  href=...`) with
  an explicit `{" "}` expression (`tersedia dari{" "}\n<a href=...`) — both render as exactly
  one space between "dari" and the link text; confirmed byte-for-byte identical rendered
  spacing.

No `prettier-ignore` or plugin-option override was needed: neither difference changes
rendered output, so the reformat is accepted as-is. See PR body for the full diff evidence.
