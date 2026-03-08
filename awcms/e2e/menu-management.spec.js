import { expect, test } from '@playwright/test';

test('admin can manage menu items end-to-end', async ({ page }) => {
  const suffix = Date.now().toString();
  const initialLabel = `Playwright Menu ${suffix}`;
  const updatedLabel = `${initialLabel} Updated`;
  const initialSlug = `playwright-menu-${suffix}`;
  const updatedSlug = `${initialSlug}-updated`;
  const initialUrl = `/playwright-${suffix}`;
  const updatedUrl = `/playwright-${suffix}-updated`;

  await page.goto('/login');
  await page.getByLabel('Email Address').fill('cms@ahliweb.com');
  await page.getByLabel('Password').fill('password123');

  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeEnabled({ timeout: 30000 });
  await signInButton.click();

  await page.waitForURL('**/cmspanel', { timeout: 60000 });
  await page.goto('/cmspanel/menus');

  await expect(page.getByRole('heading', { name: 'Menu Management' })).toBeVisible();

  await page.getByRole('button', { name: /Add Item/i }).click();
  await page.getByLabel('Label').fill(initialLabel);
  await page.getByLabel('Slug').fill(initialSlug);
  await page.getByLabel('URL Path').fill(initialUrl);
  await page.getByRole('button', { name: /Save Changes/i }).click();

  await expect(page.getByRole('button', { name: `Edit ${initialLabel}` })).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: `Edit ${initialLabel}` }).click();
  await page.getByLabel('Label').fill(updatedLabel);
  await page.getByLabel('Slug').fill(updatedSlug);
  await page.getByLabel('URL Path').fill(updatedUrl);
  await page.getByRole('button', { name: /Save Changes/i }).click();

  await expect(page.getByRole('button', { name: `Edit ${updatedLabel}` })).toBeVisible({ timeout: 30000 });

  await page.getByPlaceholder('Search labels, URLs, or linked pages').fill(updatedLabel);
  await expect(page.getByRole('button', { name: `Edit ${updatedLabel}` })).toBeVisible();

  await page.getByRole('button', { name: `Manage permissions for ${updatedLabel}` }).click();
  const allowAdmin = page.getByLabel(/Allow admin/i);
  await allowAdmin.check();
  await page.getByRole('button', { name: /Save Permissions/i }).click();
  await expect(page.getByText(`Manage Access: ${updatedLabel}`)).not.toBeVisible({ timeout: 10000 });

  await page.getByPlaceholder('Search labels, URLs, or linked pages').fill('');
  await page.getByRole('button', { name: /Save Order/i }).click();

  await page.getByPlaceholder('Search labels, URLs, or linked pages').fill(updatedLabel);
  await page.getByRole('button', { name: `Delete ${updatedLabel}` }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('button', { name: `Edit ${updatedLabel}` })).not.toBeVisible({ timeout: 30000 });
});
