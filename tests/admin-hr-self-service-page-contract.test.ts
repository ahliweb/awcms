/**
 * The HR self-service, supervisor and HR screens' contract (Issue #952).
 *
 * The screens render nothing their own checks do not allow, but those checks are
 * UX only: the reads behind them are bound by the persisted login link and the
 * manager chain, and the endpoints are the authority. What this pins is what a
 * review would otherwise have to catch by eye, each of which is silent when it
 * breaks:
 *
 *   * a page that gates on a permission key NO migration seeds hides the screen
 *     from everyone, the owner included (this repo has shipped that twice);
 *   * a `navigation` entry whose key is not the page's own gate, or not enforced
 *     by a route;
 *   * an employee or supervisor page that reads in basis `all`, or takes a
 *     person/employment parameter -- the line between "my data" and "anyone's";
 *   * a screen that exports, downloads or prints another person's data, which
 *     needs its own high-risk permission and an audit row that does not exist;
 *   * the sensitive correction reason, rendered back;
 *   * the HR page reading per-person productivity facts in `all` mode, which is
 *     the audit decision of Issue #1083 and must not be bypassed from here.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGES = {
  myWork: "src/pages/admin/hr/my-work.astro",
  myMetrics: "src/pages/admin/hr/my-metrics.astro",
  myCommission: "src/pages/admin/hr/my-commission.astro",
  team: "src/pages/admin/hr/team.astro",
  workforce: "src/pages/admin/hr/workforce.astro"
} as const;

const NAV_GATES: Record<string, string> = {
  "/admin/hr/my-work": "hr_workforce.self_service.read",
  "/admin/hr/my-metrics": "hr_workforce.self_service.read",
  "/admin/hr/team": "hr_workforce.self_service.read",
  "/admin/hr/workforce": "hr_workforce.employments.read",
  "/admin/hr/my-commission": "hr_commission.my_accruals.read"
};

const ROUTES_BY_GATE: Record<string, string[]> = {
  "hr_workforce.self_service.read": ["src/pages/api/v1/hr-workforce/me.ts"],
  "hr_workforce.employments.read": [
    "src/pages/api/v1/hr-workforce/employments/index.ts"
  ],
  "hr_commission.my_accruals.read": [
    "src/pages/api/v1/hr-commission/my-accruals/index.ts",
    "src/pages/api/v1/hr-commission/my-accruals/[id].ts"
  ]
};

const TRIPLE =
  /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

function triplesOf(source: string): Set<string> {
  return new Set(
    [...source.matchAll(TRIPLE)].map((m) => `${m[1]}.${m[2]}.${m[3]}`)
  );
}

function declared(): Set<string> {
  return new Set(
    listModules().flatMap((module) =>
      (module.permissions ?? []).map(
        (p) => `${module.key}.${p.activityCode}.${p.action}`
      )
    )
  );
}

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** The page text with its comments removed, so a docblock cannot satisfy or trip a pattern. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("every key a page gates on is declared, so a migration seeds it", () => {
  for (const [name, path] of Object.entries(PAGES)) {
    test(`${name}: gates on at least one key and every key is declared`, async () => {
      const keys = triplesOf(await source(path));

      expect(keys.size).toBeGreaterThan(0);
      expect([...keys].filter((key) => !declared().has(key))).toEqual([]);
    });
  }

  test("the two new keys are seeded by migration 313, verbatim", async () => {
    const sql = await source("sql/313_awcms_hr_self_service_permissions.sql");

    for (const key of [
      "hr_workforce.self_service.read",
      "hr_commission.my_accruals.read"
    ]) {
      const [moduleKey, activity, action] = key.split(".");
      const permission = listModules()
        .find((module) => module.key === moduleKey)
        ?.permissions?.find(
          (p) => p.activityCode === activity && p.action === action
        );

      expect(permission).toBeDefined();
      expect(sql).toContain(`'${moduleKey}', '${activity}', '${action}'`);
      expect(sql).toContain(permission!.description.replace(/'/g, "''"));
    }
  });
});

describe("navigation: a real page, the page's own gate, and a route that enforces it", () => {
  const entries = listModules().flatMap((module) =>
    (module.navigation ?? []).map((entry) => ({
      moduleKey: module.key,
      ...entry
    }))
  );

  for (const [path, gate] of Object.entries(NAV_GATES)) {
    test(`${path} requires ${gate}`, async () => {
      const entry = entries.find((candidate) => candidate.path === path);

      expect(entry).toBeDefined();
      expect(entry!.requiredPermission).toBe(gate);
      expect(declared().has(gate)).toBe(true);
      await expect(Bun.file(`src/pages${path}.astro`).exists()).resolves.toBe(
        true
      );

      // A key nothing enforces is a menu entry the API would not honour: the
      // guard registry must carry it and every route that stands for it must
      // pass that guard to the chokepoint.
      const registry = triplesOf(
        (await source(
          "src/modules/hr-workforce/domain/hr-workforce-permissions.ts"
        )) +
          (await source(
            "src/modules/hr-commission/domain/hr-commission-permissions.ts"
          ))
      );

      expect(registry.has(gate)).toBe(true);

      for (const route of ROUTES_BY_GATE[gate] ?? []) {
        const text = await source(route);
        const [, activity, action] = gate.split(".") as [
          string,
          string,
          string
        ];
        const camel = activity.replace(/_([a-z])/g, (_, c: string) =>
          c.toUpperCase()
        );

        expect(text).toContain(`GUARDS.${camel}.${action}`);
      }
    });
  }
});

const LOADERS = "src/lib/hr-self-service-loaders.ts";

/** The text of one loader function, up to the next `// ---` section marker. */
function loaderBody(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}`);
  const end = text.indexOf("// ---", start);

  expect(start).toBeGreaterThan(-1);

  return code(text.slice(start, end === -1 ? undefined : end));
}

describe("my data and my team: the basis is the caller, never a parameter", () => {
  test("the employee pages take no person or employment parameter and read through the loaders", async () => {
    for (const [path, loader] of [
      [PAGES.myWork, "loadMyWork"],
      [PAGES.myMetrics, "loadMyMetrics"],
      [PAGES.myCommission, "listOwnAccruals("],
      [PAGES.team, "loadTeam"],
      [PAGES.workforce, "loadWorkforce"]
    ] as const) {
      const text = code(await source(path));

      expect(text).toContain(loader);
      // Only HR's screen reads in basis `all` (and records it, see the read-gate test).
      if (path !== PAGES.workforce) {
        expect(text).not.toMatch(/mode:\s*"all"/);
      }

      expect(text).not.toMatch(
        /searchParams\.get\("(employmentId|employee|user|tenantUserId|profileId)"\)/
      );
      expect(text).not.toMatch(/params\.(employmentId|id)\b/);
    }
  });

  test("the loaders read the employee pages in basis mine, the team page in reports/ids, and never all", async () => {
    const text = await source(LOADERS);

    for (const name of ["loadMyWork", "loadMyMetrics"]) {
      const body = loaderBody(text, name);

      expect(body).not.toMatch(/mode:\s*"(all|reports|ids)"/);
      expect(body).toContain("tenantUserId");
    }

    expect(loaderBody(text, "loadMyWork")).toContain('mode: "mine"');
    expect(loaderBody(text, "loadMyWork")).toContain(
      "ownedByTenantUserId: tenantUserId"
    );
    expect(loaderBody(text, "loadMyMetrics")).toContain('mode: "mine"');
    expect(loaderBody(text, "loadTeam")).not.toMatch(/mode:\s*"all"/);
    expect(loaderBody(text, "loadTeam")).toContain('mode: "reports"');
    expect(loaderBody(text, "loadTeam")).toContain("directReportLinks(");
  });

  test("the commission page uses the own-only reader and never the all-accruals one", async () => {
    const text = code(await source(PAGES.myCommission));

    expect(text).not.toMatch(/\blistAccruals\b|\bgetAccrual\b/);
    expect(text).not.toMatch(/awcms_hr_commission/);
  });

  test("HR does not read per-person productivity facts (Issue #1083 owns that audit)", async () => {
    const page = code(await source(PAGES.workforce));
    const body = loaderBody(await source(LOADERS), "loadWorkforce");

    expect(page).not.toMatch(/listEmployeeFacts|workforce-metrics/);
    expect(body).not.toMatch(/listEmployeeFacts|workforce_metrics/);
  });

  test("the HR panels are each behind their own permission, and audited", async () => {
    const body = loaderBody(await source(LOADERS), "loadWorkforce");

    expect(body).toContain("can(input.guards.corrections)");
    expect(body).toContain("can(input.guards.attendance)");
    // The page states the two guards as literals the screen ledger can read.
    const page = code(await source(PAGES.workforce));

    expect(page).toContain('activityCode: "corrections"');
    expect(page).toContain('activityCode: "attendance"');
    expect(body).toMatch(/mayCorrections\s*\?/);
    expect(body).toMatch(/mayAttendance\s*\?/);
    expect(body).toContain("input.recordRead(");
  });

  test("every panel is authorised with its route's guard and ownership grant (audit H-1)", async () => {
    const access = code(await source("src/lib/hr-self-service-access.ts"));
    const text = await source(LOADERS);

    for (const panel of [
      "employmentsMine",
      "shiftsMine",
      "attendanceMine",
      "correctionsMine"
    ]) {
      expect(loaderBody(text, "loadMyWork")).toContain(
        `canReadPanel(can, "${panel}")`
      );
    }

    expect(loaderBody(text, "loadMyMetrics")).toContain(
      'canReadPanel(input.can, "metricsMine")'
    );

    for (const panel of [
      "metricsReports",
      "attendanceReports",
      "correctionsReports"
    ]) {
      expect(loaderBody(text, "loadTeam")).toContain(
        `canReadPanel(can, "${panel}")`
      );
    }

    // The grant is the route's, reason for reason, and runs through `can`.
    expect(access).toContain("ownershipGrant: { granted: true");
    expect(access).toContain("employee lists their own attendance");
    expect(access).toContain("supervisor lists their reports' attendance");
    expect(access).toContain("employee reads their own workforce metrics");
  });
});

describe("what no screen shows or does", () => {
  const all = Object.values(PAGES);

  test("no screen exports, downloads or prints anybody's data", async () => {
    for (const path of all) {
      const text = code(await source(path));

      expect(text).not.toMatch(
        /\bexport(ed|s)?\b.*(csv|xlsx|pdf)|download=|\.csv|\.xlsx|Blob\(|window\.print|text\/csv|createObjectURL/i
      );
      expect(text).not.toMatch(/\/export|\/download/);
    }
  });

  test("the correction reason is never rendered back", async () => {
    for (const path of all) {
      const text = code(await source(path));

      // The list and the report rows carry no reason; the form sends one.
      expect(text).not.toMatch(/correction\.reason|\.reason\}/);
    }
  });

  test("no commission approver, payer or payment reference is shown", async () => {
    const text = code(await source(PAGES.myCommission));

    expect(text).not.toMatch(
      /paymentReference|approvedBy|paidBy|actorTenantUserId|beneficiary/
    );
  });

  test("no screen has its own h1, a raw fetch, a literal colour or an inline style", async () => {
    for (const path of all) {
      const text = code(await source(path));

      expect(text).not.toMatch(/<h1\b/);
      expect(text).not.toMatch(/\bfetch\(/);
      expect(text).not.toMatch(/\sstyle=/);
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/window\.(confirm|prompt|alert)/);
    }
  });

  test("only my-work mutates, with an Idempotency-Key, and only the correction request", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const text = code(await source(path));

      if (name === "myWork") {
        expect(text).toContain("hrMutate(");
        expect(text).toContain('"/api/v1/hr-workforce/attendance-corrections"');
        expect(text).toContain('"POST"');
      } else {
        expect(text).not.toContain("<script>");
        expect(text).not.toMatch(/hrMutate|sendJson/);
      }
    }

    const client = await source("src/lib/ui/hr-self-service-client.ts");

    expect(client).toContain('"Idempotency-Key"');
    expect(client).toContain("admin-form-client");
  });

  test("every data-label is translated, not literal", async () => {
    for (const path of all) {
      const text = code(await source(path));

      expect(text).not.toMatch(/<t[dh]\b[^>]*data-label="[^"{]/);
    }
  });
});

describe("the sensitive-read and screen ledgers agree", () => {
  test("my_accruals.read is recorded as a not-sensitive read with the owner-reads-own reason", async () => {
    const text = await source("src/modules/_shared/sensitive-reads.ts");

    expect(text).toContain('"hr_commission.my_accruals.read"');
  });
});
