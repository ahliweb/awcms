import { expect, test } from '@playwright/test';

test('platform admin can open platform diagnostics from account menu', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('cms@ahliweb.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/cmspanel', { timeout: 60000 });

  await page.locator('header button').last().click();
  await page.getByRole('menuitem', { name: /platform diagnostics/i }).click();

  await page.waitForURL('**/cmspanel/platform/diagnostics', { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Platform Diagnostics' })).toBeVisible();
  await expect(page.getByText('Cloudflare R2')).toBeVisible();
  await expect(page.getByText('Cloudflare Edge')).toBeVisible();
  await expect(page.getByText('Supabase Storage')).toBeVisible();
  await expect(page.getByText('Blocked')).toBeVisible();
});
