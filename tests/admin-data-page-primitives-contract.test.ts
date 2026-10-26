/**
 * Structural contract of the admin data-page primitives and their first adopter
 * (Issue #1196, ADR-0149). Source-text assertions, like the sibling
 * `admin-*-page-contract` tests: no Astro render, no database.
 *
 * What is pinned is what a regression would break SILENTLY:
 *
 *  - the a11y hooks (`role="search"` with a name, `aria-sort`, `aria-disabled`,
 *    `aria-current`, a `<label for>` on the search box) — a primitive that
 *    loses one still renders and still looks right;
 *  - "no script": the primitives are SSR-only. A `<script>` in one would ship to
 *    every adopter, and an import-free one would be inlined and blocked by the
 *    `default-src 'self'` CSP with nothing to warn the author;
 *  - no inline `style=` attribute (also dropped by the CSP);
 *  - `/admin/users` uses the primitives and did NOT reach for a new API.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const DIR = "src/components/admin";
const PRIMITIVES = [
  "DataListToolbar.astro",
  "DataEmptyState.astro",
  "SortableHeader.astro",
  "KeysetPager.astro"
] as const;

async function read(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

/** Markup only: drop the frontmatter and HTML/JS comments. */
function markupOf(source: string): string {
  let markup = source.replace(/^---[\s\S]*?\n---\n/, "");
  // Repeat to a fixpoint: one pass can leave a comment opener formed from the pieces of a removed one.
  let previous: string;
  do {
    previous = markup;
    markup = markup.replace(/<!--[\s\S]*?-->/g, "");
  } while (markup !== previous);
  return markup;
}

describe("data-page primitives: shared properties", () => {
  for (const name of PRIMITIVES) {
    test(`${name} ships no script and no inline style`, async () => {
      const markup = markupOf(await read(`${DIR}/${name}`));
      expect(markup).not.toMatch(/<script[\s>]/i);
      expect(markup).not.toMatch(/\sstyle\s*=/i);
      expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    });

    test(`${name} takes its words from the catalogue, not literals`, async () => {
      const source = await read(`${DIR}/${name}`);
      // A text node that is plain English prose. Props, `t()` and symbols pass.
      const markup = markupOf(source);
      const textNodes = [...markup.matchAll(/>([^<>{}]+)</g)]
        .map((match) => (match[1] ?? "").trim())
        .filter((text) => /[A-Za-z]{3,}/.test(text));
      expect(textNodes).toEqual([]);
    });
  }
});

describe("DataListToolbar", () => {
  test("is a named GET search landmark with a labelled search box", async () => {
    const source = await read(`${DIR}/DataListToolbar.astro`);
    expect(source).toContain('method="get"');
    expect(source).toContain('role="search"');
    expect(source).toContain("aria-label={landmarkLabel}");
    expect(source).toMatch(/<label[^>]*for=\{searchId\}/);
    expect(source).toContain('type="search"');
    expect(source).toContain('name="q"');
  });

  test("every filter select has a label tied by for/id", async () => {
    const source = await read(`${DIR}/DataListToolbar.astro`);
    expect(source).toMatch(
      /for=\{`\$\{idPrefix\}-filter-\$\{filter\.name\}`\}/
    );
    expect(source).toMatch(/id=\{`\$\{idPrefix\}-filter-\$\{filter\.name\}`\}/);
  });

  test("a chip's remove control is a link named by what it removes", async () => {
    const source = await read(`${DIR}/DataListToolbar.astro`);
    expect(source).toContain("href={chip.removeHref}");
    expect(source).toContain("aria-label={removeLabel(chip.label)}");
    expect(source).toContain('aria-live="polite"');
  });
});

describe("SortableHeader", () => {
  test("sets aria-sort only for the sorted column, on a scoped column header", async () => {
    const source = await read(`${DIR}/SortableHeader.astro`);
    expect(source).toContain('scope="col"');
    expect(source).toContain("aria-sort={ariaSort}");
    // No "none": the attribute is omitted on unsorted columns.
    expect(source).not.toContain('"none"');
    expect(source).toContain('aria-hidden="true"');
  });
});

describe("KeysetPager", () => {
  test("is a named nav, marks the active size, and disables rather than omits", async () => {
    const source = await read(`${DIR}/KeysetPager.astro`);
    expect(source).toContain("<nav");
    expect(source).toContain("aria-label={label ?? t(");
    expect(source).toContain('aria-current={size.value === limit ? "true"');
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain('rel="prev"');
    expect(source).toContain('rel="next"');
  });

  test("an unavailable direction has no href, so it is not a tab stop", async () => {
    const source = await read(`${DIR}/KeysetPager.astro`);
    const disabled = [...source.matchAll(/<span[^>]*aria-disabled[^>]*>/g)];
    expect(disabled).toHaveLength(2);
    for (const match of disabled) expect(match[0]).not.toContain("href");
  });

  test("offers exactly the three sizes, and no page numbers", async () => {
    const helper = await read("src/lib/ui/admin-data-page.ts");
    expect(helper).toContain("DATA_PAGE_SIZES = [10, 25, 50]");
    const source = await read(`${DIR}/KeysetPager.astro`);
    expect(markupOf(source)).not.toMatch(/page\s*number|pageNumber/i);
  });
});

describe("DataEmptyState", () => {
  test("names the query in the filtered case and offers the clear link", async () => {
    const source = await read(`${DIR}/DataEmptyState.astro`);
    expect(source).toContain("No results for “{query}”");
    expect(source).toContain("Clear filters");
    expect(source).toContain("clearHref");
  });
});

describe("/admin/users adopts the pattern without touching the API", () => {
  test("uses all four primitives and the shared helper", async () => {
    const page = await read("src/pages/admin/users.astro");
    for (const name of [
      "DataListToolbar",
      "DataEmptyState",
      "SortableHeader",
      "KeysetPager"
    ]) {
      expect(page).toContain(`<${name}`);
    }
    expect(page).toContain("lib/ui/admin-data-page");
    expect(page).toContain("parseDataPageQuery(Astro.url.searchParams");
  });

  test("still reads through the same loader, with no query arguments added", async () => {
    const page = await read("src/pages/admin/users.astro");
    // The loader call is byte-for-byte what it was: (tx, tenantId) only.
    expect(page).toContain("listTenantUsers(tx, ssr.tenantId)");
    expect(page).not.toMatch(/listTenantUsers\([^)]*(query|cursor|limit)/);
    const loader = await read(
      "src/modules/identity-access/application/access-directory.ts"
    );
    expect(loader).toMatch(
      /export async function listTenantUsers\(\s*tx: Bun\.SQL,\s*tenantId: string\s*\)/
    );
  });

  test("the page's mutation script and its controls survive the move", async () => {
    const page = await read("src/pages/admin/users.astro");
    for (const hook of [
      "js-user-status",
      "js-assign-role",
      "js-unassign-role",
      "js-user-sessions",
      'id="users-table"',
      'id="users-action-error"'
    ]) {
      expect(page).toContain(hook);
    }
  });

  test("renders only the current page's rows", async () => {
    const page = await read("src/pages/admin/users.astro");
    expect(page).toContain("pageUsers.map((user)");
    expect(page).not.toContain("users.map((user)");
  });
});
