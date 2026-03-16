import { chromium } from "../../../awcms/node_modules/playwright/index.mjs";

const baseUrl =
  process.env.AWCMS_PUBLIC_E2E_BASE_URL || "http://127.0.0.1:4321";

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/en/events`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const listingText = await page.locator("body").textContent();
  if (!listingText?.includes("AWCMS Extension Launch Workshop")) {
    throw new Error(
      "Events listing page did not render the seeded event title",
    );
  }

  await page
    .getByRole("link", { name: /view details/i })
    .first()
    .click();
  await page.waitForLoadState("networkidle");

  const detailText = await page.locator("body").textContent();
  if (!detailText?.includes("AWCMS Extension Launch Workshop")) {
    throw new Error("Event detail page did not render the expected title");
  }

  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
