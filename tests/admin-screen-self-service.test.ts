/**
 * `loadSelfServiceScreen` is bounded to an ENUMERATED set of screens (ADR-0096).
 *
 * ## What this is guarding against
 *
 * `access:chokepoint:check` requires every admin screen to open its transaction
 * through one of the helpers, and it now counts `loadSelfServiceScreen` — which
 * performs NO authorization. That is correct for a screen whose subject is the
 * caller, and it is a hole for any screen that is not: without this list, a
 * screen showing other people's data could satisfy the chokepoint gate by
 * calling the helper that decides nothing.
 *
 * So the list is the control, in the same shape as
 * `BOUNDED_BY_DESIGN` in `data-lifecycle-table-coverage.test.ts`: enumerated,
 * reasoned, disputable, and meant to stay short. An entry here is a claim a
 * reviewer can argue with — "this screen genuinely has no entry permission" —
 * not a place to park a screen because writing the permission was inconvenient.
 *
 * Pure — reads source text. No database, no network.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const SCREENS_ROOT = "src/pages/admin";

/**
 * Screens permitted to skip authorization, and why.
 *
 * The bar for an entry: the screen must show ONLY data about the caller, and it
 * must accept no parameter that could name somebody else. A screen that reads a
 * tenant's data — even data the caller is very likely allowed to see — does not
 * qualify, because "very likely allowed" is the judgement the chokepoint exists
 * to make.
 */
const SELF_SERVICE_SCREENS: Readonly<Record<string, string>> = {
  "account.astro":
    "ADR-0096 — every row it reads is the caller's own: their profile, their sessions, their MFA factor, their stored preferences. It accepts no id, so there is nothing it could be pointed at. An entry permission here would have to be an action no migration seeds, which denies everyone including the tenant owner (ADR-0058 §E) — on the screen a person reaches for when they think their password leaked."
};

async function listScreens(): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (entry.name.endsWith(".astro")) {
        found.push(path.relative(SCREENS_ROOT, full));
      }
    }
  };

  await walk(SCREENS_ROOT);

  return found;
}

describe("loadSelfServiceScreen is bounded", () => {
  test("only enumerated screens call it", async () => {
    const screens = await listScreens();

    // Guard the fixture: an empty scan would pass vacuously, which is how the
    // first version of the module-absence gate covered zero files while
    // appearing to cover them all.
    expect(screens.length).toBeGreaterThan(20);

    const callers: string[] = [];

    for (const screen of screens) {
      const source = await readFile(path.join(SCREENS_ROOT, screen), "utf8");

      if (/loadSelfServiceScreen\(/.test(source)) callers.push(screen);
    }

    expect(callers.sort()).toEqual(Object.keys(SELF_SERVICE_SCREENS).sort());
  });

  test("every enumerated screen still exists and still calls it", async () => {
    // A dead entry is a claim about nothing, and it reads as coverage.
    for (const screen of Object.keys(SELF_SERVICE_SCREENS)) {
      const source = await readFile(path.join(SCREENS_ROOT, screen), "utf8");

      expect(source).toContain("loadSelfServiceScreen(");
    }
  });

  test("every entry carries a reason a reviewer could dispute", async () => {
    // Same bar as `BOUNDED_BY_DESIGN`: a sentence short enough to be a label is
    // not an argument, and "self-service" without saying WHY is the exact shape
    // of the lie this list attracts.
    for (const reason of Object.values(SELF_SERVICE_SCREENS)) {
      expect(reason.trim().length).toBeGreaterThan(120);
    }
  });

  test("the list stays short — an unauthorized-screen list that grows is a hole", async () => {
    // One today. A second entry should be a design conversation: it means a
    // second screen claims to be about nobody but its caller, and that claim is
    // exactly what a reviewer should be forced to check.
    expect(Object.keys(SELF_SERVICE_SCREENS).length).toBeLessThanOrEqual(1);
  });

  test("each caller passes a written selfServiceReason", async () => {
    // The helper's type requires the field; this requires it to say something.
    // A `selfServiceReason: ""` would typecheck and mean nothing.
    for (const screen of Object.keys(SELF_SERVICE_SCREENS)) {
      const source = await readFile(path.join(SCREENS_ROOT, screen), "utf8");
      const reason = /selfServiceReason:\s*(["'`])([\s\S]*?)\1/.exec(source);

      expect(reason).not.toBeNull();
      expect((reason?.[2] ?? "").trim().length).toBeGreaterThan(40);
    }
  });
});
