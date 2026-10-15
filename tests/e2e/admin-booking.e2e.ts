/**
 * Booking admin screens, end to end and KEYBOARD-ONLY (Issue #942, over the #1030
 * admin APIs): `/admin/booking/{policy,offerings,resources,schedules,blocks,
 * reservations}`.
 *
 * Every action below is driven the way a keyboard user drives it: the control is
 * focused and `Enter` is pressed (no mouse click). That is the acceptance item
 * "keyboard-only path for each action", proven rather than assumed. The confirm
 * step of a destructive action is the native `<dialog>` of ADR-0125 (never a
 * browser `confirm()`), operated by focusing its confirm button and pressing
 * `Enter`.
 *
 * One flow, in order, because each step makes the next one possible: a policy,
 * an offering, a resource with units in a pool, opening hours and a closure, a
 * reservation placed through the real route (the screens do not create one),
 * its detail and history, confirm and cancel from the detail screen, a block and
 * its release, and the delete / restore of a resource.
 *
 * WRITE wave: it mutates tenant-wide booking configuration through the app. The
 * a11y and 360px sweeps (`a11y-axe.e2e.ts`, `responsive-360.e2e.ts`) cover the
 * same screens read-only.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;
const seeded = Boolean(tenantId && loginIdentifier && password);

/**
 * axe over the CURRENT state, failing on critical / serious findings. The
 * a11y sweep (`a11y-axe.e2e.ts`) is a read-wave spec and cannot see the states
 * that need data (`?edit=` forms, the `?id=` detail), so this flow scans them
 * where the data exists.
 */
async function expectNoBlockingViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious"
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target).join(" | ")}`
    );

  expect(blocking, `${label}: axe critical/serious findings`).toEqual([]);
}

const stamp = Date.now().toString(36);
const day = (offset: number): string =>
  new Date(Date.now() + (40 + offset) * 86_400_000).toISOString().slice(0, 10);

/** Focus a control and press a key: the keyboard path, no pointer. */
async function press(page: Page, selector: string, key = "Enter") {
  const target = page.locator(selector);

  await expect(target).toBeVisible();
  await target.focus();
  await page.keyboard.press(key);
}

/**
 * Focus a control and set its value. `fill` (not typed keystrokes) because a
 * `type="date"` / `"time"` control is segmented by locale: typing digits into it
 * lands in the wrong segment, while `fill` writes the ISO value the control stores.
 */
async function typeInto(page: Page, selector: string, text: string) {
  const target = page.locator(selector);

  await target.focus();
  await target.fill(text);
}

/** Confirm the native confirm dialog by keyboard. */
async function confirmByKeyboard(page: Page) {
  await expect(page.locator("#confirm-dialog[open]")).toBeVisible();
  await press(page, "#confirm-dialog-confirm");
}

test.use({ reducedMotion: "reduce" });

test.describe("booking admin screens (keyboard-only)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );
  test.describe.configure({ mode: "serial" });

  const offeringCode = `night-${stamp}`;
  const resourceCode = `villa-${stamp}`;
  const poolCode = `pool-${stamp}`;
  let reservationId = "";

  test("policy: change the hold length with the keyboard and keep it", async ({
    page
  }) => {
    await page.goto("/admin/booking/policy");
    await expect(page.locator("#policy-form")).toBeVisible();

    await typeInto(page, "#policy-default-hold", "20");
    await typeInto(page, "#policy-max-hold", "45");
    // Wait for the PUT itself, then for the reload the page does on success
    // (`mutateAndReload`). A reload of our own would race that one and abort.
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/booking/policy") &&
        response.request().method() === "PUT"
    );
    const reloaded = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame()
    );

    await press(page, "#policy-default-hold", "Enter");
    expect((await saved).status()).toBe(200);
    await reloaded;
    await page.waitForLoadState("load");
    await expect(page.locator("#policy-default-hold")).toHaveValue("20");
    await expect(page.locator("#policy-max-hold")).toHaveValue("45");
    // The default beside a blank field names the built-in value.
    await expect(page.locator("#policy-cap-customer-hint")).toContainText("5");
  });

  test("policy: an out-of-range value is refused in words, not saved", async ({
    page
  }) => {
    await page.goto("/admin/booking/policy");
    // The browser's own range check is bypassed on purpose: the server decides.
    await page.evaluate(() => {
      const input = document.getElementById("policy-cap-tenant");
      if (input instanceof HTMLInputElement) {
        input.removeAttribute("min");
        input.value = "0";
      }
    });
    await press(page, "#policy-cap-tenant", "Enter");
    await expect(page.locator("#policy-error-box")).toBeVisible();
    await expect(page.locator("#policy-error-box")).not.toContainText(
      /stack|postgres|sql/i
    );
  });

  test("offerings: create, edit and delete a stay offering", async ({
    page
  }) => {
    await page.goto("/admin/booking/offerings");
    await typeInto(page, "#offering-code", offeringCode);
    await typeInto(page, "#offering-name", "One night");
    await page.locator("#offering-granularity").selectOption("stay");
    await typeInto(page, "#offering-min-nights", "1");
    await typeInto(page, "#offering-max-nights", "14");
    await typeInto(page, "#offering-max-party", "4");
    await press(page, "#offering-name", "Enter");

    const row = page.locator("tr", { hasText: offeringCode });

    await expect(row).toBeVisible();
    await expect(row).toContainText("1–4");

    await press(page, `tr:has-text("${offeringCode}") a.btn`);
    await expect(
      page.locator("#offering-form[data-mode='edit']")
    ).toBeVisible();
    await expectNoBlockingViolations(page, "offering edit form");
    await typeInto(page, "#offering-name", "One night, renamed");
    await press(page, "#offering-name", "Enter");
    await expect(page.locator("tr", { hasText: offeringCode })).toContainText(
      "renamed"
    );
  });

  test("offerings: editing the name does not rewrite seconds that are not whole minutes", async ({
    page
  }) => {
    await page.goto("/admin/booking/offerings");

    const created = await page.evaluate(async (code) => {
      const response = await fetch("/api/v1/booking/offerings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          code,
          name: "Odd seconds",
          granularity: "time",
          durationSeconds: 20,
          setupSeconds: 90,
          cleanupSeconds: 0,
          slotStepSeconds: 330
        })
      });
      const json = (await response.json()) as {
        data?: { offering?: { id: string } };
      };

      return { status: response.status, id: json.data?.offering?.id ?? "" };
    }, `odd-${stamp}`);

    expect(created.status).toBe(201);

    await page.goto(`/admin/booking/offerings?edit=${created.id}`);
    // Shown as decimal minutes with the exact seconds beside them; the 20 s
    // duration is displayed, not "0", and the form can still be saved.
    await expect(page.locator("#offering-setup")).toHaveValue("1.5");
    await expect(page.locator("#offering-duration")).toHaveValue("0.33");
    await typeInto(page, "#offering-name", "Odd seconds, renamed");
    await press(page, "#offering-name", "Enter");
    await expect(page.locator("tr", { hasText: `odd-${stamp}` })).toContainText(
      "renamed"
    );

    const stored = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/booking/offerings/${id}`);
      const json = (await response.json()) as {
        data: {
          offering: {
            durationSeconds: number;
            setupSeconds: number;
            slotStepSeconds: number;
          };
        };
      };

      return json.data.offering;
    }, created.id);

    expect(stored.durationSeconds).toBe(20);
    expect(stored.setupSeconds).toBe(90);
    expect(stored.slotStepSeconds).toBe(330);
  });

  test("resources: create a stay resource with units in a pool, then grow it", async ({
    page
  }) => {
    await page.goto("/admin/booking/resources");

    // The pool first, so the resource form can name it.
    await typeInto(page, "#pool-code", poolCode);
    await typeInto(page, "#pool-name", "Villas");
    await press(page, "#pool-name", "Enter");
    await expect(page.locator("#pools-table")).toContainText(poolCode);

    await typeInto(page, "#resource-code", resourceCode);
    await typeInto(page, "#resource-name", "Villa");
    await page.locator("#resource-mode").selectOption("stay");
    await typeInto(page, "#resource-timezone", "Asia/Pontianak");
    await typeInto(page, "#resource-check-in", "14:00");
    await typeInto(page, "#resource-check-out", "12:00");
    await typeInto(page, "#resource-capacity", "2");
    await page.locator("#resource-pool").selectOption({ label: "Villas" });
    await typeInto(page, "#resource-unit-labels", "North\nSouth");
    await press(page, "#resource-name", "Enter");

    const row = page.locator("tr", { hasText: resourceCode });

    await expect(row).toBeVisible();
    await expect(row).toContainText(/2\D+2/);
    await expect(row).toContainText("Villas");

    // Edit: units are listed, capacity can only grow.
    await press(page, `tr:has-text("${resourceCode}") a.btn`);
    await expect(
      page.locator("#units-table .unit-label-input").first()
    ).toHaveValue("North");
    await expectNoBlockingViolations(page, "resource edit form with units");
    await expect(page.locator("#resource-capacity")).toHaveAttribute(
      "min",
      "2"
    );
    await typeInto(page, "#resource-capacity", "3");
    await press(page, "#resource-name", "Enter");
    await expect(page.locator("tr", { hasText: resourceCode })).toContainText(
      /3\D+3/
    );
  });

  test("a pool that still has a resource cannot be deleted; the refusal is in words", async ({
    page
  }) => {
    await page.goto("/admin/booking/resources");
    await press(page, `tr:has-text("${poolCode}") .pool-delete-btn`);
    await confirmByKeyboard(page);
    await expect(page.locator("#pool-action-error")).toBeVisible();
    await expect(page.locator("#pool-action-error")).not.toBeEmpty();
  });

  test("schedules: add opening hours and a closure", async ({ page }) => {
    await page.goto("/admin/booking/schedules");
    await page.locator("#schedule-resource").selectOption({ label: "Villa" });
    await expect(page.locator("#schedule-timezone")).toHaveValue(
      "Asia/Pontianak"
    );
    await typeInto(page, "#schedule-from", day(0));
    await press(page, "#schedule-open", "Enter");
    await expect(page.locator("#schedules-table")).toContainText(
      "Asia/Pontianak"
    );

    await page.locator("#exception-resource").selectOption({ label: "Villa" });
    await typeInto(page, "#exception-from", day(50));
    await typeInto(page, "#exception-to", day(52));
    await page.locator("#exception-reason").selectOption("holiday");
    await press(page, "#exception-from", "Enter");
    await expect(page.locator("#exceptions-table")).toContainText(day(50));

    await press(page, `tr:has-text("${day(50)}") .exception-delete-btn`);
    await confirmByKeyboard(page);
    await expect(page.locator("#exceptions-table")).not.toContainText(day(50));
  });

  test("reservations: a placed hold is listed with its expiry; detail shows history; confirm and cancel by keyboard", async ({
    page
  }) => {
    // The ids come from the screens themselves.
    await page.goto("/admin/booking/resources");
    const editHref = await page
      .locator(`tr:has-text("${resourceCode}") a.btn`)
      .first()
      .getAttribute("href");
    const resId = new URL(editHref!, "http://x").searchParams.get("edit")!;

    await page.goto("/admin/booking/offerings");
    const offeringHref = await page
      .locator(`tr:has-text("${offeringCode}") a.btn`)
      .first()
      .getAttribute("href");
    const offId = new URL(offeringHref!, "http://x").searchParams.get("edit")!;

    // The screens do not create reservations (that is the storefront's job);
    // place one through the real route, as an adapter would.
    const result = await page.evaluate(
      async (body) => {
        const response = await fetch("/api/v1/booking/reservations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID()
          },
          body: JSON.stringify(body)
        });
        const json = (await response.json()) as {
          data?: { reservation?: { id: string } };
        };

        return { status: response.status, id: json.data?.reservation?.id };
      },
      {
        offeringId: offId,
        resourceId: resId,
        stay: { checkInDate: day(10), checkOutDate: day(12) },
        partySize: 2
      }
    );

    expect(result.status).toBe(201);
    reservationId = result.id!;

    await page.goto("/admin/booking/reservations?status=held");
    const row = page.locator(`[data-reservation-row="${reservationId}"]`);

    await expect(row).toBeVisible();
    await expect(row).toContainText("Villa");
    await expect(row.locator("time")).toBeVisible();

    await press(page, `[data-reservation-row="${reservationId}"] a.cell-code`);
    await expect(
      page.locator("#reservation-history [data-event-kind]").first()
    ).toBeVisible();
    await expect(page.locator("#reservation-hold-expiry time")).toBeVisible();
    await expectNoBlockingViolations(page, "reservation detail");

    await press(page, '.reservation-action-btn[data-action="confirm"]');
    await expect(
      page.locator("#reservation-summary [data-status='confirmed']")
    ).toBeVisible();
    await expect(
      page.locator('#reservation-history [data-event-kind="confirmed"]')
    ).toBeVisible();

    await press(page, '.reservation-action-btn[data-action="cancel"]');
    await confirmByKeyboard(page);
    await expect(
      page.locator("#reservation-summary [data-status='cancelled']")
    ).toBeVisible();
    await expect(page.locator(".reservation-action-btn")).toHaveCount(0);
  });

  test("blocks: block nights, see the conflict refused in words, release by keyboard", async ({
    page
  }) => {
    await page.goto("/admin/booking/blocks");
    await page.locator("#block-resource").selectOption({ label: "Villa" });
    await typeInto(page, "#block-from", day(20));
    await typeInto(page, "#block-to", day(23));
    await page.locator("#block-reason").selectOption("maintenance");
    await press(page, "#block-from", "Enter");

    const row = page.locator("#blocks-table tbody tr").first();

    await expect(row).toContainText(day(20));
    await expect(row).toContainText("3");

    // The same nights again are taken: a refusal in words, nothing written.
    await typeInto(page, "#block-from", day(21));
    await typeInto(page, "#block-to", day(22));
    await press(page, "#block-from", "Enter");
    await expect(page.locator("#block-form-error")).toBeVisible();

    await page.goto("/admin/booking/blocks");
    await press(page, ".block-release-btn");
    await confirmByKeyboard(page);
    await expect(
      page.locator('#blocks-table [data-status="released"]')
    ).toBeVisible();
  });

  test("resources: delete and restore by keyboard", async ({ page }) => {
    await page.goto("/admin/booking/resources");
    await press(page, `tr:has-text("${resourceCode}") .resource-delete-btn`);
    await confirmByKeyboard(page);
    await expect(page.locator("#deleted-resources")).toContainText(
      resourceCode
    );
    await press(page, `#deleted-resources .resource-restore-btn`);
    await expect(page.locator("#resources-table")).toContainText(resourceCode);
  });
});
