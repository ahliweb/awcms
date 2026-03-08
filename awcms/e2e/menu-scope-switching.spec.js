import { expect, test } from '@playwright/test';

test('admin can switch menu location and locale scopes', async ({ page }) => {
  const suffix = Date.now().toString();
  const label = `Scoped Menu ${suffix}`;
  const slug = `scoped-menu-${suffix}`;
  const url = `/scoped-${suffix}`;

  await page.goto('/login');
  await page.getByLabel('Email Address').fill('cms@ahliweb.com');
  await page.getByLabel('Password').fill('password123');

  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeEnabled({ timeout: 30000 });
  await signInButton.click();

  await page.waitForURL('**/cmspanel', { timeout: 60000 });
  await page.goto('/cmspanel/menus');

  await expect(page.getByRole('heading', { name: 'Menu Management' })).toBeVisible();

  await page.getByRole('button', { name: 'Footer' }).click();
  await expect(page.getByText('Managing:')).toContainText('Footer');

  await page.getByRole('button', { name: /Bahasa Indonesia/i }).click();
  await expect(page.getByRole('button', { name: /Bahasa Indonesia/i })).toHaveClass(/bg-primary/);

  await page.getByRole('button', { name: /Add Item/i }).click();
  await page.getByLabel('Label').fill(label);
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('URL Path').fill(url);
  await page.getByRole('button', { name: /Save Changes/i }).click();

  await expect(page.getByRole('button', { name: `Edit ${label}` })).toBeVisible({ timeout: 30000 });

  await page.getByPlaceholder('Search labels, URLs, or linked pages').fill(label);
  await expect(page.getByRole('button', { name: `Edit ${label}` })).toBeVisible();

  await page.getByRole('button', { name: 'Primary Header' }).click();
  await page.getByRole('button', { name: /English/i }).click();
  await expect(page.getByText('Managing:')).toContainText('Primary Header');
  await expect(page.getByRole('button', { name: `Edit ${label}` })).not.toBeVisible();

  await page.getByRole('button', { name: 'Footer' }).click();
  await page.getByRole('button', { name: /Bahasa Indonesia/i }).click();
  await expect(page.getByRole('button', { name: `Edit ${label}` })).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: `Delete ${label}` }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: `Edit ${label}` })).not.toBeVisible({ timeout: 30000 });
});
