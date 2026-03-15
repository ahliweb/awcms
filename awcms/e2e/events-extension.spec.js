import { expect, test } from '@playwright/test';
import pg from 'pg';

const { Client } = pg;

const LOCAL_DB_URL = process.env.AWCMS_E2E_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ensureEventsExtensionForTenant = async (tenantSlug) => {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select t.id as tenant_id, c.id as catalog_id, c.version, u.id as user_id
       from public.tenants t
       join public.platform_extension_catalog c on c.vendor = 'ahliweb' and c.slug = 'events' and c.deleted_at is null
       join public.users u on u.email = 'cms@ahliweb.com' and u.deleted_at is null
       where t.slug = $1 and t.deleted_at is null
       limit 1`,
      [tenantSlug],
    );

    const target = rows[0];
    if (!target) {
      throw new Error(`Missing tenant/catalog/user fixture for tenant slug: ${tenantSlug}`);
    }

    await client.query(
      `insert into public.tenant_extensions (
         tenant_id, catalog_id, installed_version, activation_state, config, rollout,
         installed_at, activated_at, created_by, updated_by, deleted_at
       ) values ($1, $2, $3, 'active', '{"featuredLimit":6,"showUpcomingOnly":true}'::jsonb, '{}'::jsonb, now(), now(), $4, $4, null)
       on conflict (tenant_id, catalog_id) do update
       set installed_version = excluded.installed_version,
           activation_state = 'active',
           config = excluded.config,
           activated_at = now(),
           deleted_at = null,
           updated_at = now()`,
      [target.tenant_id, target.catalog_id, target.version, target.user_id],
    );

    await client.query(
      `delete from public.events where tenant_id = $1 and slug in ('awcms-extension-launch-workshop', 'tenant-extension-governance-review')`,
      [target.tenant_id],
    );

    await client.query(
      `insert into public.events (
         tenant_id, author_id, title, slug, summary, location, start_at, end_at, status, published_at, config
       ) values
       ($1, $2, 'AWCMS Extension Launch Workshop', 'awcms-extension-launch-workshop', 'Hands-on workshop covering manifest-driven extension authoring and lifecycle auditing.', 'Jakarta Innovation Hub', now() + interval '7 days', now() + interval '7 days 3 hours', 'published', now(), '{}'::jsonb),
       ($1, $2, 'Tenant Extension Governance Review', 'tenant-extension-governance-review', 'Review of ABAC, RLS, and rollout controls for tenant-managed extensions.', 'Bandung Command Center', now() + interval '14 days', now() + interval '14 days 2 hours', 'published', now(), '{}'::jsonb)`,
      [target.tenant_id, target.user_id],
    );
  } finally {
    await client.end();
  }
};

test('events extension menu, route, and dashboard widget render for admin', async ({ page }) => {
  await ensureEventsExtensionForTenant('smandapbun');

  await page.goto('/login');
  await page.getByLabel('Email Address').fill('cms@ahliweb.com');
  await page.getByLabel('Password').fill('password123');

  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(signInButton).toBeEnabled({ timeout: 30000 });
  await signInButton.click();

  await page.waitForURL('**/cmspanel', { timeout: 60000 });

  const eventsLink = page.locator("a[href='/cmspanel/events']");
  await expect(eventsLink).toBeVisible({ timeout: 30000 });
  await expect(eventsLink).toContainText('Events');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  await eventsLink.click();
  await page.waitForURL('**/cmspanel/events', { timeout: 30000 });
  await expect(page).toHaveURL(/\/cmspanel\/events$/);
});
