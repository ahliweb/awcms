/**
 * Every permission-gated admin screen must be able to SAY it denied.
 *
 * ## The contract, and why a hook rather than just a message
 *
 * `loadAdminScreen` never redirects — `src/lib/auth/admin-screen.ts` explains
 * why — so a denied screen RENDERS, and the page decides what that looks like.
 * The convention is an element carrying `id="<screen>-denied"`.
 *
 * Forty-three screens followed it. Four — `site-profile`, `blog-settings`,
 * `sidebar-menu`, `comments` — rendered a correct denial message with no id on
 * it. Nothing was broken for a user: they saw the right words. What was broken
 * was **verifiability**. No mechanical check could tell those four apart from a
 * screen that renders its content to someone with no permission at all, because
 * there was nothing to look for.
 *
 * That is why this gate exists and why it is worth a test rather than a
 * convention: a denial nobody can assert on is a denial nobody will notice
 * losing.
 *
 * The companion is `tests/e2e/admin-deny-path.e2e.ts`, which logs in as a user
 * holding no permissions and requires every one of these hooks to actually
 * appear. This gate keeps the hooks present; that one keeps them honest.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { listFilesRecursive } from "../scripts/lib/repo-files";

const ROOT = path.resolve(import.meta.dir, "..");
const ADMIN_ROOT = path.join(ROOT, "src/pages/admin");

/**
 * `/admin/account` loads through `loadSelfServiceScreen`, which has no
 * permission to deny — every authenticated user owns their own account page.
 * Identified by the loader it calls rather than by name, so the exemption
 * cannot outlive the reason for it.
 */
function isSelfService(source: string): boolean {
  return source.includes("loadSelfServiceScreen");
}

type Screen = { file: string; relative: string; source: string };

const screens: Screen[] = listFilesRecursive(ADMIN_ROOT)
  .filter((file) => file.endsWith(".astro"))
  .map((file) => ({
    file,
    relative: path.relative(ROOT, file),
    source: readFileSync(file, "utf8")
  }));

const gated = screens.filter((screen) => !isSelfService(screen.source));

describe("admin deny path", () => {
  test("the screen walk found them", () => {
    // A walk that stops matching turns every assertion below into a loop over
    // nothing, which passes. That failure mode has cost this repo real defects.
    expect(screens.length).toBeGreaterThan(40);
    expect(gated.length).toBeGreaterThan(40);
  });

  test("every gated screen loads through loadAdminScreen", () => {
    // The authorization chokepoint for a SCREEN. A page that reads its data
    // without it has no deny path at all, and no amount of markup would give
    // it one.
    for (const screen of gated) {
      expect(
        screen.source.includes("loadAdminScreen"),
        `${screen.relative} does not call loadAdminScreen, so it has no deny path.`
      ).toBe(true);
    }
  });

  test("every gated screen carries a `-denied` hook", () => {
    // Four screens rendered a correct denial with no id, which made them
    // indistinguishable — to any checker — from a screen that shows its
    // contents to a user with no permission.
    for (const screen of gated) {
      expect(
        /id="[a-z0-9-]+-denied"/.test(screen.source),
        `${screen.relative} renders no id="…-denied" element. ` +
          "Deny RENDERS here (it never redirects), so the denied state needs a " +
          "hook the e2e can require — otherwise nothing can tell a working " +
          "denial from a screen that leaks its contents."
      ).toBe(true);
    }
  });

  test("the self-service exemption names a real screen and is not a pattern", () => {
    // One screen, identified by the loader it calls. If this ever grows, the
    // growth should be a decision somebody made rather than a filter widening
    // quietly.
    const selfService = screens.filter((screen) =>
      isSelfService(screen.source)
    );
    expect(selfService.map((screen) => screen.relative)).toEqual([
      "src/pages/admin/account.astro"
    ]);
  });
});
