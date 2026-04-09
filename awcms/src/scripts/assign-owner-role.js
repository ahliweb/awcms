
import pg from 'pg';

const connectionString = process.env.DATABASE_URL
    || 'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';
const { Pool } = pg;
const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000
});

const EMAIL = 'cms@ahliweb.com';
const TENANT_SLUG = 'primary';
const TARGET_ROLE_NAME = 'owner';
const TARGET_ROLE_SCOPE = 'platform';

async function assignOwnerRole() {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Fail queries fast if locked
        await client.query("SET statement_timeout = 5000");

        console.log(`--- Assigning '${TARGET_ROLE_NAME}' Role to '${EMAIL}' ---`);

        // 1. Get Tenant ID
        const tenantRes = await client.query("SELECT id FROM public.tenants WHERE slug = $1", [TENANT_SLUG]);
        if (tenantRes.rows.length === 0) throw new Error(`Tenant '${TENANT_SLUG}' not found.`);
        const tenantId = tenantRes.rows[0].id;
        console.log(`Tenant ID: ${tenantId}`);

        // 2. Ensure Owner Role Exists
        let ownerRoleId;
        const roleRes = await client.query(
            "SELECT id, tenant_id FROM public.roles WHERE lower(name) = $1 AND deleted_at IS NULL ORDER BY tenant_id NULLS FIRST",
            [TARGET_ROLE_NAME]
        );
        const globalRole = roleRes.rows.find(row => row.tenant_id === null);
        const tenantRole = roleRes.rows.find(row => row.tenant_id === tenantId);
        const selectedRole = globalRole || tenantRole;

        if (!selectedRole) {
            console.log(`Role '${TARGET_ROLE_NAME}' not found. Creating global platform role...`);
            const newRole = await client.query(`
                INSERT INTO public.roles (tenant_id, name, description, scope, is_platform_admin, is_full_access, is_tenant_admin)
                VALUES (NULL, $1, 'Full access owner role', $2, true, true, true)
                RETURNING id
            `, [TARGET_ROLE_NAME, TARGET_ROLE_SCOPE]);
            ownerRoleId = newRole.rows[0].id;
            console.log(`Created '${TARGET_ROLE_NAME}' Role ID: ${ownerRoleId}`);
        } else {
            ownerRoleId = selectedRole.id;
            console.log(`Found '${TARGET_ROLE_NAME}' Role ID: ${ownerRoleId}`);
        }

        await client.query(`
            UPDATE public.roles
            SET is_platform_admin = true,
                is_full_access = true,
                is_tenant_admin = true,
                scope = $2,
                updated_at = NOW()
            WHERE id = $1
        `, [ownerRoleId, TARGET_ROLE_SCOPE]);

        // 3. Get User ID
        const userRes = await client.query("SELECT id FROM public.users WHERE email = $1", [EMAIL]);
        if (userRes.rows.length === 0) throw new Error(`User '${EMAIL}' not found.`);
        const userId = userRes.rows[0].id;
        console.log(`User ID: ${userId}`);

        // 4. Update Public Users Role ID
        console.log(`Updating public.users role_id to '${ownerRoleId}'...`);
        await client.query(
            "UPDATE public.users SET role_id = $1, tenant_id = $2, full_name = COALESCE(full_name, 'System Owner') WHERE id = $3",
            [ownerRoleId, tenantId, userId]
        );
        console.log(`Updated public.users role_id.`);

        // 6. Grant All Permissions to Owner Role
        console.log("Granting all permissions to Owner role...");
        const grantRes = await client.query(`
            INSERT INTO public.role_permissions (role_id, permission_id)
            SELECT $1, id
            FROM public.permissions
            WHERE NOT EXISTS (
                SELECT 1 FROM public.role_permissions rp
                WHERE rp.role_id = $1 AND rp.permission_id = public.permissions.id
            );
        `, [ownerRoleId]);
        console.log(`Granted ${grantRes.rowCount} new permissions to Owner role.`);

        await client.query('COMMIT');

    } catch (err) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error assigning owner role:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

assignOwnerRole();
