/**
 * The email admin screens at a phone width, with axe (Issue #1162):
 * `/admin/email-queue`, `/admin/email-webhooks` and `/admin/email-senders`.
 *
 * The whole-fleet sweeps (`responsive-360`, `a11y-axe`) walk the routes the
 * filesystem yields, but on a fresh database a table that renders only once a
 * row exists is walked EMPTY (the failure `responsive-360` already records for
 * `/admin/access-policies`). So this spec seeds two terminal queue rows (a
 * sent message with a long subject and a failed one with a long error) and
 * then asserts, for each screen, at 360px:
 *
 * - the page has its `h1` and one of its own named states (never a blank body);
 * - the document does not scroll sideways (WCAG 1.4.10 reflow);
 * - axe finds nothing critical or serious, in light AND dark.
 *
 * READ wave: the seed goes straight to the database (a read-wave spec may not
 * mutate through the app), and both rows are terminal (`sent`, `failed`), so the
 * dispatcher never claims them and no other spec's expectation can see them as
 * work. The channel registry may be switched off on the e2e server; the
 * webhooks and senders screens then render their own "switched off" notice,
 * which is the state this spec is entitled to assert. The page-level decision
 * logic (isolation, review offered, paging) is covered against a real database
 * by `tests/integration/admin-email-webhooks-screen.integration.test.ts`.
 *
 * Not covered here, and said plainly: the action buttons (cancel, confirm,
 * dismiss, issue, revoke, make default) are WRITES; their request/answer
 * contract is held by the page-contract tests and the endpoints' integration
 * tests.
 */
import AxeBuilder from "@axe-core/playwright";

import { test, expect, type Page } from "./support/e2e-read-wave";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const seeded = Boolean(tenantId && loginIdentifier && password && databaseUrl);

const LONG_SUBJECT =
  "A deliberately long subject line that must wrap inside its cell instead of widening the page at a phone width";
const LONG_ERROR =
  "provider_rejected: a deliberately long diagnostic line that is well over the cut-off the page applies, so it must be shortened and never stretch the table at a phone width";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
] as const;

const SCREENS = [
  {
    path: "/admin/email-queue",
    heading: "Email queue",
    // The seeded rows render the table; an empty queue renders its own message.
    state: "#email-queue-table, #email-queue-empty"
  },
  {
    path: "/admin/email-webhooks",
    heading: "Email webhooks",
    state:
      "#email-webhooks-trust, #email-webhooks-disabled, #email-webhooks-unavailable"
  },
  {
    path: "/admin/email-senders",
    heading: "Email senders",
    state:
      "#email-accounts-table, #email-senders-disabled, #email-senders-unavailable, #email-senders-migration"
  }
] as const;

async function seedTerminalMessages(): Promise<void> {
  const sql = new Bun.SQL(databaseUrl!, { max: 1 });

  try {
    await sql.begin(async (tx: Bun.SQL) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

      for (const [status, error] of [
        ["sent", null],
        ["failed", LONG_ERROR]
      ] as const) {
        await tx`
          INSERT INTO awcms_email_messages
            (tenant_id, category, status, to_address, to_address_hash,
             to_address_masked, subject, sender_selection, last_error, sent_at)
          VALUES (${tenantId}, 'system.announcement', ${status},
                  ${`e2e-1162-${status}@recipient.test`},
                  ${`e2e-1162-hash-${status}`}, 'e•••@recipient.test',
                  ${LONG_SUBJECT}, 'deployment', ${error},
                  ${status === "sent" ? new Date() : null})
        `;
      }
    });
  } finally {
    await sql.end();
  }
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
}

test.describe("email admin screens at 360px", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant and DATABASE_URL — CI e2e-smoke provides both"
  );

  test.beforeAll(async () => {
    await seedTerminalMessages();
  });

  for (const screen of SCREENS) {
    for (const theme of ["light", "dark"] as const) {
      test(`${screen.path} (${theme}): has its heading and a named state, fits 360px, no serious axe finding`, async ({
        page,
        baseURL
      }) => {
        await page.setViewportSize({ width: 360, height: 640 });
        await page
          .context()
          .addCookies([{ name: "awcms_locale", value: "en", url: baseURL! }]);
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(screen.path);

        await expect(
          page.getByRole("heading", { level: 1, name: screen.heading })
        ).toBeVisible();
        await expect(page.locator(screen.state).first()).toBeVisible();

        expect(
          await overflow(page),
          `${screen.path}: horizontal overflow in px`
        ).toBeLessThanOrEqual(0);

        const results = await new AxeBuilder({ page })
          .withTags([...WCAG_TAGS])
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

        expect(blocking, `${screen.path}: axe critical/serious`).toEqual([]);
      });
    }
  }

  test("the queue masks the recipient and cuts the long error", async ({
    page,
    baseURL
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page
      .context()
      .addCookies([{ name: "awcms_locale", value: "en", url: baseURL! }]);
    await page.goto("/admin/email-queue?status=failed");

    const html = await page.content();

    expect(html).not.toContain("e2e-1162-failed@recipient.test");
    expect(html).toContain("e•••@recipient.test");
    expect(html).not.toContain(LONG_ERROR);
    await expect(page.locator("#email-queue-table")).toContainText(
      "provider_rejected"
    );
  });
});
