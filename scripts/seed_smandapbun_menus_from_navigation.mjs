import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const rootDir = '/home/data/dev_react/awcms-dev';
const require = createRequire(path.join(rootDir, 'awcms/package.json'));
const { createClient } = require('@supabase/supabase-js');
const adminEnvPath = path.join(rootDir, 'awcms/.env');
const navigationPath = path.join(rootDir, 'awcms-public/smandapbun/src/data/navigation.json');
const tenantSlug = 'smandapbun';
const targetLocations = ['header', 'mobile_menu'];

function parseEnvFile(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

function flattenMenuTree(items, locale, location, tenantId, parentId = null, depth = 0, prefix = '') {
  return items.flatMap((item, index) => {
    const nodeId = `${prefix}${item.id}`;
    const menuId = crypto.randomUUID();
    const sortOrder = (index + 1) * 10;
    const row = {
      id: menuId,
      tenant_id: tenantId,
      name: item.id,
      label: item.label?.[locale] || item.label?.id || item.label?.en || item.id,
      slug: nodeId,
      url: item.href,
      parent_id: parentId,
      order: sortOrder,
      location,
      group_label: location,
      locale,
      is_active: true,
      is_public: true,
      icon: item.icon || null,
      page_id: null,
      role_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    const children = Array.isArray(item.children)
      ? flattenMenuTree(item.children, locale, location, tenantId, menuId, depth + 1, `${nodeId}__`)
      : [];

    return [row, ...children];
  });
}

async function main() {
  const env = parseEnvFile(await fs.readFile(adminEnvPath, 'utf8'));
  const navigation = JSON.parse(await fs.readFile(navigationPath, 'utf8'));

  const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  const { data: tenant, error: tenantError } = await supabase
    .rpc('get_tenant_by_slug', { lookup_slug: tenantSlug })
    .maybeSingle();

  if (tenantError) {
    throw tenantError;
  }

  if (!tenant?.id) {
    throw new Error(`Tenant not found for slug ${tenantSlug}`);
  }

  const tenantId = tenant.id;
  const archivedAt = new Date().toISOString();

  const { error: archiveError } = await supabase
    .from('menus')
    .update({ deleted_at: archivedAt, updated_at: archivedAt })
    .eq('tenant_id', tenantId)
    .in('location', targetLocations)
    .is('deleted_at', null);

  if (archiveError) {
    throw archiveError;
  }

  const rows = targetLocations.flatMap((location) => [
    ...flattenMenuTree(navigation.mainMenu || [], 'id', location, tenantId),
    ...flattenMenuTree(navigation.mainMenu || [], 'en', location, tenantId),
  ]);

  const { error: insertError } = await supabase.from('menus').insert(rows);
  if (insertError) {
    throw insertError;
  }

  const summary = {};
  for (const location of targetLocations) {
    const { data, error } = await supabase
      .from('menus')
      .select('id, locale', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('location', location)
      .is('deleted_at', null);

    if (error) {
      throw error;
    }

    summary[location] = {
      total: data.length,
      byLocale: data.reduce((acc, row) => {
        acc[row.locale] = (acc[row.locale] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  console.log(JSON.stringify({ tenantId, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
