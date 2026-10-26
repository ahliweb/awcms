/**
 * Pure rules of the admin data-page pattern (Issue #1196, ADR-0149): reading
 * and writing the URL state, removing a chip, and the keyset slice.
 */
import { describe, expect, test } from "bun:test";

import {
  buildActiveFilterChips,
  buildClearFiltersHref,
  buildDataPageHref,
  buildSortHeaderState,
  decodeSliceCursor,
  encodeSliceCursor,
  hasActiveFilters,
  parseDataPageQuery,
  sliceKeyset,
  type DataPageSpec
} from "../src/lib/ui/admin-data-page";

const SPEC: DataPageSpec = {
  filterKeys: ["status", "role"],
  sortKeys: ["identifier", "status"],
  defaultSort: "identifier",
  defaultDir: "asc"
};
const BASE = "/admin/users";

function query(search: string) {
  return parseDataPageQuery(new URLSearchParams(search), SPEC);
}

describe("parseDataPageQuery", () => {
  test("an empty URL is the default state", () => {
    expect(query("")).toEqual({
      q: "",
      filters: {},
      sort: "identifier",
      dir: "asc",
      cursor: null,
      limit: 25
    });
  });

  test("reads every declared parameter", () => {
    expect(
      query(
        "q=%20rina%20&status=active&role=owner&sort=status&dir=desc&limit=50"
      )
    ).toEqual({
      q: "rina",
      filters: { status: "active", role: "owner" },
      sort: "status",
      dir: "desc",
      cursor: null,
      limit: 50
    });
  });

  test("ignores filters the page did not declare", () => {
    expect(query("admin=1&status=active").filters).toEqual({
      status: "active"
    });
  });

  test("falls back instead of throwing on junk", () => {
    const parsed = query("sort=password&dir=sideways&limit=1000000&cursor=");
    expect(parsed.sort).toBe("identifier");
    expect(parsed.dir).toBe("asc");
    expect(parsed.limit).toBe(25);
    expect(parsed.cursor).toBeNull();
  });

  test("a dir without a recognised sort does not flip the default", () => {
    expect(query("dir=desc").dir).toBe("asc");
  });

  test("truncates an over-long search", () => {
    expect(query(`q=${"x".repeat(500)}`).q).toHaveLength(100);
  });
});

describe("buildDataPageHref", () => {
  test("the default state is the bare path", () => {
    expect(buildDataPageHref(BASE, SPEC, query(""))).toBe(BASE);
  });

  test("round-trips a non-default state", () => {
    const href = buildDataPageHref(
      BASE,
      SPEC,
      query("q=rina&status=active&sort=status&dir=desc&limit=10")
    );
    expect(href).toBe(
      "/admin/users?q=rina&status=active&sort=status&dir=desc&limit=10"
    );
  });

  test("any change but paging drops the cursor", () => {
    const current = query("cursor=abc&status=active");
    expect(
      buildDataPageHref(BASE, SPEC, current, { filters: { role: "owner" } })
    ).toBe("/admin/users?status=active&role=owner");
    expect(buildDataPageHref(BASE, SPEC, current, { limit: 50 })).toBe(
      "/admin/users?status=active&limit=50"
    );
    expect(buildDataPageHref(BASE, SPEC, current, { cursor: "next" })).toBe(
      "/admin/users?status=active&cursor=next"
    );
  });

  test("escapes the search text", () => {
    expect(buildDataPageHref(BASE, SPEC, query(""), { q: "a&b=c d" })).toBe(
      "/admin/users?q=a%26b%3Dc+d"
    );
  });

  test("null removes a filter and keeps the others", () => {
    expect(
      buildDataPageHref(BASE, SPEC, query("status=active&role=owner"), {
        filters: { status: null }
      })
    ).toBe("/admin/users?role=owner");
  });
});

describe("chips", () => {
  const describeChip = (key: string, value: string) => `${key}=${value}`;

  test("one chip per active filter, search first, each removing only itself", () => {
    const current = query("q=rina&status=active&role=owner&limit=10");
    const chips = buildActiveFilterChips(BASE, SPEC, current, describeChip);
    expect(chips.map((chip) => chip.id)).toEqual(["q", "status", "role"]);
    expect(chips[0]?.removeHref).toBe(
      "/admin/users?status=active&role=owner&limit=10"
    );
    expect(chips[1]?.removeHref).toBe(
      "/admin/users?q=rina&role=owner&limit=10"
    );
    expect(chips[2]?.removeHref).toBe(
      "/admin/users?q=rina&status=active&limit=10"
    );
  });

  test("no chips when nothing is applied", () => {
    expect(buildActiveFilterChips(BASE, SPEC, query(""), describeChip)).toEqual(
      []
    );
    expect(hasActiveFilters(query(""))).toBe(false);
    expect(hasActiveFilters(query("status=active"))).toBe(true);
  });

  test("clear removes search and filters but keeps sort and size", () => {
    expect(
      buildClearFiltersHref(
        BASE,
        SPEC,
        query("q=a&status=active&sort=status&dir=desc&limit=10&cursor=zz")
      )
    ).toBe("/admin/users?sort=status&dir=desc&limit=10");
  });
});

describe("buildSortHeaderState", () => {
  test("an unsorted column sorts ascending first", () => {
    expect(buildSortHeaderState(BASE, SPEC, query(""), "status")).toEqual({
      href: "/admin/users?sort=status&dir=asc",
      direction: null
    });
  });

  test("the sorted column flips, and reports its direction", () => {
    expect(buildSortHeaderState(BASE, SPEC, query(""), "identifier")).toEqual({
      href: "/admin/users?sort=identifier&dir=desc",
      direction: "asc"
    });
    expect(
      buildSortHeaderState(
        BASE,
        SPEC,
        query("sort=identifier&dir=desc"),
        "identifier"
      )
    ).toEqual({ href: BASE, direction: "desc" });
  });

  test("sorting resets the cursor", () => {
    expect(
      buildSortHeaderState(BASE, SPEC, query("cursor=abc"), "status").href
    ).not.toContain("cursor");
  });
});

describe("sliceKeyset", () => {
  type Row = { id: string; name: string };
  const rows: Row[] = ["e", "b", "a", "d", "c", "f", "g"].map((name, n) => ({
    id: `id-${n}`,
    name
  }));
  const run = (cursor: string | null, dir: "asc" | "desc" = "asc", limit = 3) =>
    sliceKeyset(rows, {
      sortValue: (row) => row.name,
      id: (row) => row.id,
      dir,
      limit,
      cursor
    });

  test("first page", () => {
    const page = run(null);
    expect(page.items.map((row) => row.name)).toEqual(["a", "b", "c"]);
    expect(page.prevCursor).toBeNull();
    expect(page.nextCursor).not.toBeNull();
    expect([page.from, page.to, page.total]).toEqual([1, 3, 7]);
  });

  test("walks forward to the end and back again without gaps or repeats", () => {
    const first = run(null);
    const second = run(first.nextCursor);
    const third = run(second.nextCursor);
    expect(second.items.map((row) => row.name)).toEqual(["d", "e", "f"]);
    expect(third.items.map((row) => row.name)).toEqual(["g"]);
    expect(third.nextCursor).toBeNull();
    expect([third.from, third.to]).toEqual([7, 7]);

    const backToSecond = run(third.prevCursor);
    expect(backToSecond.items.map((row) => row.name)).toEqual(["d", "e", "f"]);
    const backToFirst = run(backToSecond.prevCursor);
    expect(backToFirst.items.map((row) => row.name)).toEqual(["a", "b", "c"]);
    expect(backToFirst.prevCursor).toBeNull();
  });

  test("descending order mirrors", () => {
    const page = run(null, "desc");
    expect(page.items.map((row) => row.name)).toEqual(["g", "f", "e"]);
    const next = run(page.nextCursor, "desc");
    expect(next.items.map((row) => row.name)).toEqual(["d", "c", "b"]);
    expect(run(next.prevCursor, "desc").items.map((row) => row.name)).toEqual([
      "g",
      "f",
      "e"
    ]);
  });

  test("equal sort values are ordered by id, so no row is skipped", () => {
    const ties: Row[] = [3, 1, 2, 5, 4].map((n) => ({
      id: `id-${n}`,
      name: "same"
    }));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ReturnType<typeof sliceKeyset<Row>> = sliceKeyset(ties, {
        sortValue: (row) => row.name,
        id: (row) => row.id,
        dir: "asc",
        limit: 2,
        cursor
      });
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(["id-1", "id-2", "id-3", "id-4", "id-5"]);
  });

  test("a garbage cursor is the first page, not an error", () => {
    expect(run("not-a-cursor").items.map((row) => row.name)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(
      decodeSliceCursor(Buffer.from("{}").toString("base64url"))
    ).toBeNull();
    expect(decodeSliceCursor(null)).toBeNull();
  });

  test("a cursor whose anchor row has since left the list still lands sensibly", () => {
    const cursor = encodeSliceCursor({ d: "a", k: "bb", i: "gone" });
    expect(run(cursor).items.map((row) => row.name)).toEqual(["c", "d", "e"]);
  });

  test("an empty list", () => {
    const page = sliceKeyset([] as Row[], {
      sortValue: (row) => row.name,
      id: (row) => row.id,
      dir: "asc",
      limit: 10,
      cursor: null
    });
    expect(page).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      from: 0,
      to: 0,
      total: 0
    });
  });
});
