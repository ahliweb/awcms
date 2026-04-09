
import pg from 'pg';

const connectionString = process.env.DATABASE_URL
    || 'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';
const { Pool } = pg;
const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2000 // Fail fast
});

const EMAIL = 'cms@ahliweb.com';
const TENANT_SLUG = 'primary';
const TARGET_ROLE_NAME = 'owner';

async function checkUserAndRole() {
    let client;
    try {
        client = await pool.connect();
        console.log(`--- Checking User '${EMAIL}' and Role '${TARGET_ROLE_NAME}' ---`);

        // 1. Get Tenant ID
        const tenantRes = await client.query("SELECT id FROM public.tenants WHERE slug = $1", [TENANT_SLUG]);
        if (tenantRes.rows.length === 0) {
            console.error(`Tenant '${TENANT_SLUG}' not found.`);
            return;
        }
        const tenantId = tenantRes.rows[0].id;
        console.log(`Tenant ID: ${tenantId}`);

        // 2. Check for Owner Role
        const roleRes = await client.query(
            `SELECT id, name, tenant_id, scope, is_platform_admin, is_full_access, is_tenant_admin
             FROM public.roles
             WHERE lower(name) = $1 AND deleted_at IS NULL
             ORDER BY tenant_id NULLS FIRST, created_at ASC`,
            [TARGET_ROLE_NAME]
        );
        console.log('Matching owner roles:', roleRes.rows);

        const ownerRole = roleRes.rows.find(r => r.tenant_id === null) || roleRes.rows.find(r => r.tenant_id === tenantId);
        let ownerRoleId;

        if (!ownerRole) {
            console.log(`Role '${TARGET_ROLE_NAME}' does not exist.`);
        } else {
            ownerRoleId = ownerRole.id;
            console.log(`Found '${TARGET_ROLE_NAME}' Role ID: ${ownerRoleId}`);
            const permRes = await client.query("SELECT count(*) FROM public.role_permissions WHERE role_id = $1", [ownerRoleId]);
            console.log(`Owner role has ${permRes.rows[0].count} permissions.`);
        }

        // 3. Get User
        const userRes = await client.query(
            `SELECT u.id, u.email, u.full_name, u.tenant_id, r.id AS role_id, r.name AS role_name,
                    r.scope, r.is_platform_admin, r.is_full_access, r.is_tenant_admin
             FROM public.users u
             LEFT JOIN public.roles r ON r.id = u.role_id
             WHERE u.email = $1`,
            [EMAIL]
        );
        if (userRes.rows.length === 0) {
            console.error(`User '${EMAIL}' not found in public.users.`);
            return;
        }
        const user = userRes.rows[0];
        console.log('User row:', user);

        const authUserRes = await client.query(
            `SELECT id, email, email_confirmed_at IS NOT NULL AS email_confirmed
             FROM auth.users
             WHERE email = $1`,
            [EMAIL]
        );
        console.log('Auth row:', authUserRes.rows[0] || null);

        if (user.tenant_id !== tenantId) {
            console.warn(`Expected tenant_id ${tenantId}, found ${user.tenant_id}`);
        }

        if (ownerRoleId && user.role_id !== ownerRoleId) {
            console.warn(`Expected role_id ${ownerRoleId}, found ${user.role_id}`);
        }

    } catch (err) {
        console.error('Error checking user/role:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

checkUserAndRole();
