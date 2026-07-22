import { expect, type Page } from "@playwright/test";

/**
 * Provide the tenant for `/login` regardless of the auto tenant-picker shape.
 *
 * The login page resolves the tenant field server-side by how many active
 * tenants exist (see `src/pages/login.astro`):
 *   - exactly 1  → `#tenant-id` is a HIDDEN input, already prefilled with that
 *                  tenant's id (the user picks nothing). Playwright cannot
 *                  `.fill()` a hidden input, so we assert the prefill instead —
 *                  which also proves the auto-pick chose the right tenant.
 *   - 2..50      → `#tenant-id` is a `<select>` of tenant names (value = id).
 *   - 0 or >50   → `#tenant-id` is a visible TEXT input (manual entry).
 *
 * The CI e2e-smoke job seeds exactly one tenant, so the hidden-prefill branch
 * is the one it exercises; the others keep the helper correct for local
 * multi-tenant / pre-setup runs.
 */
export async function provideTenant(
  page: Page,
  tenantId: string
): Promise<void> {
  const field = page.locator("#tenant-id");
  const tagName = await field.evaluate((el) => el.tagName.toLowerCase());

  if (tagName === "select") {
    await field.selectOption(tenantId);
    return;
  }

  if ((await field.getAttribute("type")) === "hidden") {
    await expect(field).toHaveValue(tenantId);
    return;
  }

  await field.fill(tenantId);
}
