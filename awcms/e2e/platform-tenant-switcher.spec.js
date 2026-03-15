import { expect, test } from '@playwright/test';

test('platform admin can switch tenant scope from the header', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('cms@ahliweb.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/cmspanel', { timeout: 60000 });

  const scopeTrigger = page.locator('[role="combobox"]').first();
  const currentScope = (await scopeTrigger.textContent())?.trim() || '';
  const targetScope = currentScope.includes('SMAN 2 Pangkalan Bun') ? /Primary Tenant/i : /SMAN 2 Pangkalan Bun/i;

  await scopeTrigger.click();
  await page.getByRole('option', { name: targetScope }).click();
  await expect(scopeTrigger).toContainText(targetScope);

  await page.reload();
  await page.waitForURL('**/cmspanel', { timeout: 60000 });
  await expect(page.locator('[role="combobox"]').first()).toContainText(targetScope);
});
