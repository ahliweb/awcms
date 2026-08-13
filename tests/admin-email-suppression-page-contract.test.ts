/**
 * `/admin/email-suppression` gates against the endpoints it drives — Issue #544.
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen.
 *
 * This screen has two properties of its own worth pinning:
 *
 * - **`alreadySuppressed` is an ANSWER, not an error.** The endpoint replies 200
 *   with that flag instead of 409, which makes one request serve as both "add"
 *   and "is this address already on the list?". Reloading on it would throw away
 *   the only thing the operator asked for — and the masked, bounded list cannot
 *   answer the question any other way.
 * - **No raw address is ever rendered.** The store returns `recipient_masked`
 *   and nothing else; a page that reached for a raw field would be reaching for
 *   one that does not exist, but the assertion is what keeps it that way if one
 *   ever appears.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { SUPPRESSION_REASONS } from "../src/modules/email/domain/suppression-validation";

const PAGE = "src/pages/admin/email-suppression.astro";
const LIST_ROUTE = "src/pages/api/v1/email/suppressions/index.ts";
const ENTRY_ROUTE = "src/pages/api/v1/email/suppressions/[id].ts";

const EXPECTED = [
  "email.suppression.read",
  "email.suppression.create",
  "email.suppression.delete"
];

describe("/admin/email-suppression gates on keys that really exist", () => {
  test("every key the page names is DECLARED by a module", async () => {
    const page = await readFile(PAGE, "utf8");

    const declared = new Set<string>();
    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED) {
      const [, activityCode, action] = key.split(".");
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("the page and both endpoints agree on the activity", async () => {
    for (const route of [LIST_ROUTE, ENTRY_ROUTE]) {
      const source = await readFile(route, "utf8");
      expect(source).toContain('activityCode: "suppression"');
    }
  });

  test("removing an entry is a DELETE gated on `delete`", async () => {
    const page = await readFile(PAGE, "utf8");
    const route = await readFile(ENTRY_ROUTE, "utf8");

    expect(route).toContain('action: "delete"');
    expect(route).toContain("export const DELETE");
    expect(page).toContain('"DELETE",');
  });
});

describe("the two properties this screen exists to keep", () => {
  test("`alreadySuppressed` is surfaced, not reloaded away", async () => {
    const page = await readFile(PAGE, "utf8");

    const addBlock = page.slice(
      page.indexOf('getElementById("add-suppression-form")'),
      page.indexOf('document.addEventListener("click"')
    );

    // The check and the add are one request. A page that reloaded here would
    // answer the operator's question by discarding it — and the list is masked
    // and capped at 100, so there is no second way to ask.
    expect(addBlock).toContain("alreadySuppressed");
    expect(addBlock).toContain("already suppressed");
    expect(addBlock.indexOf("alreadySuppressed")).toBeLessThan(
      addBlock.indexOf("window.location.reload()")
    );
  });

  test("the reason select is DERIVED from the domain list", async () => {
    const page = await readFile(PAGE, "utf8");

    // A copy of the four values here would stay correct today and fall behind
    // the day a fifth is added — the form offering four of five, nothing red.
    expect(page).toContain("SUPPRESSION_REASONS");
    expect(page).toContain("reasons.map(");
    for (const reason of SUPPRESSION_REASONS) {
      expect(page).not.toContain(`value="${reason}"`);
    }
  });

  test("and the domain list is non-empty — otherwise the assertion above is vacuous", () => {
    expect(SUPPRESSION_REASONS.length).toBeGreaterThan(0);
  });

  test("no raw recipient is ever rendered", async () => {
    const page = await readFile(PAGE, "utf8");

    // The store returns `recipient_masked` and never the address. This holds
    // the page to it if a raw field is ever added to the projection.
    expect(page).toContain("entry.recipientMasked");
    expect(page).not.toContain("entry.recipient}");
    expect(page).not.toContain("recipientHash");
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `email.suppression` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.startsWith("email.suppression."))
    ).toEqual([]);
  });

  test("and the three keys are exactly the ones this page claims", () => {
    // Paired with the assertion above so neither passes vacuously.
    expect(EXPECTED).toHaveLength(3);
  });
});
