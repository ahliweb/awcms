/**
 * L-1 (security audit of Issue #952): the query parameters a self-service page
 * may read, and the value every `tenantUserId` is bound to. A page whose subject
 * is the caller reads the caller from `auth.context.tenantUserId` and from
 * nothing else, so a parameter such as `?as=<someone>` can never choose whose
 * data the page shows.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const PAGES = {
  myWork: "src/pages/admin/hr/my-work.astro",
  myMetrics: "src/pages/admin/hr/my-metrics.astro",
  myCommission: "src/pages/admin/hr/my-commission.astro",
  team: "src/pages/admin/hr/team.astro",
  workforce: "src/pages/admin/hr/workforce.astro"
} as const;

/** Allow-list per page: the ONLY query parameters it reads, none of which names a person. */
const ALLOWED_PARAMS: Record<string, readonly string[]> = {
  [PAGES.myWork]: [],
  [PAGES.myMetrics]: ["period"],
  [PAGES.myCommission]: ["status", "cursor"],
  [PAGES.team]: ["period"],
  [PAGES.workforce]: ["state", "cursor"]
};

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function subjectViolations(path: string, text: string): string[] {
  const body = code(text);
  const problems: string[] = [];
  const allowed = ALLOWED_PARAMS[path] ?? [];

  for (const match of body.matchAll(/searchParams\.get\(\s*"([^"]+)"\s*\)/g)) {
    if (!allowed.includes(match[1]!)) {
      problems.push(`reads the query parameter "${match[1]}"`);
    }
  }

  // Every binding of a *tenantUserId must be the caller's own value.
  for (const match of body.matchAll(
    /\b([A-Za-z]*[tT]enantUserId)\s*[:=]\s*([^;,\n}]+)/g
  )) {
    const value = match[2]!.trim();

    if (value !== "auth.context.tenantUserId" && value !== "tenantUserId") {
      problems.push(`binds ${match[1]} to "${value}"`);
    }
  }

  if (/(\?\?|\|\|)\s*auth\.context\.tenantUserId/.test(body)) {
    problems.push("falls back to the caller only when another value is absent");
  }

  return problems;
}

describe("only the caller can be the subject of a self-service page", () => {
  for (const path of Object.values(PAGES)) {
    test(`${path}: reads only its allow-listed parameters and binds every tenantUserId to the caller`, async () => {
      const text = await readFile(path, "utf8");

      // The scan found something to check (a vacuous pass is the usual failure).
      expect(text).toContain("auth");
      expect(subjectViolations(path, text)).toEqual([]);
    });
  }

  test("the pages that name a subject really do bind it to the caller", async () => {
    for (const path of [PAGES.myWork, PAGES.myCommission, PAGES.team]) {
      expect(await readFile(path, "utf8")).toContain(
        "auth.context.tenantUserId"
      );
    }
  });

  test("taking the subject from a parameter turns the check red", async () => {
    const team = await readFile(PAGES.team, "utf8");
    const mutated = team.replace(
      "tenantUserId: auth.context.tenantUserId,",
      'tenantUserId: Astro.url.searchParams.get("as") ?? auth.context.tenantUserId,'
    );

    expect(mutated).not.toBe(team);

    const problems = subjectViolations(PAGES.team, mutated);

    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join("\n")).toContain('"as"');

    const work = await readFile(PAGES.myWork, "utf8");
    const swapped = work.replace(
      "tenantUserId: auth.context.tenantUserId,",
      'tenantUserId: Astro.url.searchParams.get("u"),'
    );

    expect(swapped).not.toBe(work);
    expect(subjectViolations(PAGES.myWork, swapped).length).toBeGreaterThan(0);
  });
});
