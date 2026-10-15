/**
 * The six `/admin/booking/*` screens gate against the endpoints they drive
 * (Issue #942, over the #1030 admin APIs).
 *
 * What this pins, from the page source alone:
 *
 *   * each screen CLAIMS exactly the permissions listed here, and every one is
 *     declared by the module, SEEDED by `sql/181` and ENFORCED by a route
 *     (the latent-authz trap: a permission no migration seeds denies everyone,
 *     including the owner, while the code reads as correctly guarded);
 *   * every `navigation` entry names a real page whose own entry guard is the
 *     entry's `requiredPermission`, and no page is reachable only by URL;
 *   * every mutation the page script sends goes through `bookingMutate` (the one
 *     sender that adds an `Idempotency-Key`) to a route and METHOD that exist,
 *     and the permission that route enforces is one the page claims;
 *   * no raw browser dialog, no raw `fetch`, no inline `style=`, no `<h1>` of its
 *     own (the shell owns the title, ADR-0120), no customer note or reference.
 *
 * What it does NOT answer: whether a control is correct for a row's state. The
 * Playwright flow (`tests/e2e/admin-booking.e2e.ts`) drives that.
 *
 * Pure -- no database, no network. Runs in `quality` on every PR.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { extractScreenClaims } from "../scripts/admin-screen-coverage-check";
import { listModules } from "../src/modules";
import { BOOKING_GUARDS } from "../src/modules/booking/domain/booking-permissions";
import { extractScreenAuthorizeKeys } from "./e2e/support/admin-screen-authorize";

const PAGES: Record<
  string,
  { file: string; entry: string; claims: string[]; deniedId: string }
> = {
  "/admin/booking/reservations": {
    file: "src/pages/admin/booking/reservations.astro",
    entry: "booking.reservations.read",
    deniedId: "reservations-denied",
    claims: [
      "booking.reservations.read",
      "booking.reservations.confirm",
      "booking.reservations.cancel",
      "booking.reservations.check_in",
      "booking.reservations.complete",
      "booking.reservations.no_show",
      "booking.resources.read"
    ]
  },
  "/admin/booking/resources": {
    file: "src/pages/admin/booking/resources.astro",
    entry: "booking.resources.read",
    deniedId: "resources-denied",
    claims: [
      "booking.resources.read",
      "booking.resources.create",
      "booking.resources.update",
      "booking.resources.delete",
      "booking.resources.restore"
    ]
  },
  "/admin/booking/offerings": {
    file: "src/pages/admin/booking/offerings.astro",
    entry: "booking.offerings.read",
    deniedId: "offerings-denied",
    claims: [
      "booking.offerings.read",
      "booking.offerings.create",
      "booking.offerings.update",
      "booking.offerings.delete",
      "booking.offerings.restore"
    ]
  },
  "/admin/booking/schedules": {
    file: "src/pages/admin/booking/schedules.astro",
    entry: "booking.schedules.read",
    deniedId: "schedules-denied",
    claims: [
      "booking.schedules.read",
      "booking.schedules.create",
      "booking.schedules.update",
      "booking.schedules.delete",
      "booking.resources.read"
    ]
  },
  "/admin/booking/blocks": {
    file: "src/pages/admin/booking/blocks.astro",
    entry: "booking.blocks.read",
    deniedId: "blocks-denied",
    claims: [
      "booking.blocks.read",
      "booking.blocks.create",
      "booking.blocks.release",
      "booking.resources.read"
    ]
  },
  "/admin/booking/policy": {
    file: "src/pages/admin/booking/policy.astro",
    entry: "booking.policy.read",
    deniedId: "policy-denied",
    claims: ["booking.policy.read", "booking.policy.configure"]
  }
};

const MIGRATION = readFileSync("sql/181_awcms_booking_permissions.sql", "utf8");
const booking = listModules().find((module) => module.key === "booking")!;
const declared = new Set(
  (booking.permissions ?? []).map(
    (permission) => `booking.${permission.activityCode}.${permission.action}`
  )
);

function seeded(key: string): boolean {
  const [moduleKey, activity, action] = key.split(".");

  return MIGRATION.includes(`('${moduleKey}', '${activity}', '${action}'`);
}

/** The permission the route file's `METHOD` handler enforces, through `BOOKING_GUARDS`. */
function enforcedBy(file: string, method: string): string | null {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`export const ${method} =`);

  if (start === -1) return null;

  const match = /authorize:\s*BOOKING_GUARDS\.(\w+)\.(\w+)/.exec(
    source.slice(start)
  );

  if (!match) return null;

  const guards = BOOKING_GUARDS as unknown as Record<
    string,
    Record<string, { moduleKey: string; activityCode: string; action: string }>
  >;
  const guard = guards[match[1]!]?.[match[2]!];

  return guard
    ? `${guard.moduleKey}.${guard.activityCode}.${guard.action}`
    : null;
}

/**
 * `{ method, url }` pairs the script sends through `bookingMutate`. The
 * reservation screen's `/${verb}` is expanded over the verbs its `actions` table
 * names, so each transition route is checked rather than one placeholder.
 */
function mutations(source: string): { method: string; url: string }[] {
  const verbs = [...source.matchAll(/\bverb:\s*"([a-z-]+)"/g)].map(
    (match) => match[1]!
  );

  return [
    ...source.matchAll(
      /"(POST|PATCH|PUT|DELETE)",\s*([`"])(\/api\/v1\/booking\/[^`"]+)\2/g
    )
  ].flatMap((match) =>
    match[3]!.includes("${verb}")
      ? verbs.map((verb) => ({
          method: match[1]!,
          url: match[3]!.replace("${verb}", verb)
        }))
      : [{ method: match[1]!, url: match[3]! }]
  );
}

function routeFile(url: string): string | null {
  const path = url
    .replace(/\$\{[^}]+\}/g, "[id]")
    .replace(/^\/api\/v1\/booking\//, "");
  const base = `src/pages/api/v1/booking/${path}`;

  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

describe("the booking admin screens", () => {
  test("the fixture is not vacuous", () => {
    expect(Object.keys(PAGES)).toHaveLength(6);
    expect(declared.size).toBeGreaterThan(25);
  });

  for (const [path, page] of Object.entries(PAGES)) {
    describe(path, () => {
      const source = readFileSync(page.file, "utf8");

      test("claims exactly the permissions it drives, all declared and seeded", () => {
        expect([...extractScreenClaims(source)].sort()).toEqual(
          [...page.claims].sort()
        );

        for (const key of page.claims) {
          expect(declared.has(key)).toBe(true);
          expect(seeded(key)).toBe(true);
        }
      });

      test("its entry guard is its navigation permission, and it renders a denial hook", () => {
        expect(extractScreenAuthorizeKeys(source)).toEqual([page.entry]);
        expect(source).toContain(`id="${page.deniedId}"`);

        const entry = (booking.navigation ?? []).find(
          (nav) => nav.path === path
        );

        expect(entry?.requiredPermission).toBe(page.entry);
      });

      test("every mutation is an Idempotency-Key send to a route and method that exist, enforcing a permission the page claims", () => {
        const sent = mutations(source);

        expect(sent.length).toBeGreaterThan(0);

        for (const { method, url } of sent) {
          const file = routeFile(url);

          expect(file, `${method} ${url} has no route file`).not.toBeNull();

          const enforced = enforcedBy(file!, method);

          expect(
            enforced,
            `${method} ${url} enforces no BOOKING_GUARDS`
          ).not.toBeNull();
          expect(
            page.claims,
            `${method} ${url} enforces ${enforced}, which the page does not claim`
          ).toContain(enforced!);
        }

        // Every send is `bookingMutate`: it is the only one that adds the key.
        expect(source).not.toMatch(/\bfetch\(/);
        expect(source).not.toMatch(/\bsendJson\(/);
        expect(source).not.toMatch(/\bmutateAndReload\(/);
      });

      test("no raw dialog, no inline style, no own <h1>, no customer data", () => {
        expect(source).not.toMatch(/window\.(confirm|prompt|alert)\(/);
        expect(source).not.toMatch(/\bstyle="/);
        expect(source).not.toMatch(/<h1[\s>]/);
        expect(source).not.toMatch(
          /externalCustomerRef|customerNote|customer_note/
        );
      });

      test("no minutes arithmetic in the page: the format library owns the seconds round trip", () => {
        expect(source).not.toMatch(/[*/]\s*60\b/);
        expect(source).not.toMatch(/Math\.round\(/);

        if (source.includes("collectBody(")) {
          // A form page renders what it sent back: the original API value.
          expect(source).toContain("data-original");
          expect(source).toContain("data-initial");
        }
      });

      test("its script imports the admin form client (CSP: bundled as an external file)", () => {
        expect(source).toMatch(
          /from "\.\.\/\.\.\/\.\.\/lib\/ui\/admin-form-client"/
        );
      });
    });
  }

  test("every navigation entry of the module has a page, and every booking page an entry", () => {
    const navPaths = (booking.navigation ?? []).map((nav) => nav.path).sort();

    expect(navPaths).toEqual(Object.keys(PAGES).sort());

    for (const nav of booking.navigation ?? []) {
      expect(existsSync(PAGES[nav.path]!.file)).toBe(true);
      expect(declared.has(nav.requiredPermission!)).toBe(true);
      expect(seeded(nav.requiredPermission!)).toBe(true);
    }
  });

  test("the permissions NOT claimed by a screen are the ones the coverage ledger names", async () => {
    const claimed = new Set(
      Object.values(PAGES).flatMap((page) => page.claims)
    );
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");
    const ledger = new Set(
      NOT_YET_SCREENED.filter((key: string) => key.startsWith("booking."))
    );
    const unclaimed = [...declared].filter((key) => !claimed.has(key)).sort();

    expect([...ledger].sort()).toEqual(unclaimed);
  });

  test("the reservation screen is one view of one page, not a dynamic route", () => {
    expect(existsSync("src/pages/admin/booking/reservations/[id].astro")).toBe(
      false
    );
  });

  test("the shared sender draws its Idempotency-Key from the repo's source, keyed on the request", () => {
    const client = readFileSync("src/lib/ui/booking-admin-client.ts", "utf8");

    expect(client).toContain("createIdempotencyKeySource");
    expect(client).toMatch(/keyFor\(\{ method, url, body \}\)/);
    // A fresh key per click would turn a retry after a lost response into a
    // second attempt (and a false CODE_TAKEN / BLOCK_CONFLICT).
    expect(client).not.toMatch(/randomUUID\(\)/);
  });
});
