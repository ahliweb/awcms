
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Default local Supabase connection
const connectionString = process.env.DATABASE_URL
    || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const { Pool } = pg;
const pool = new Pool({ connectionString });

async function createAdminUser() {
    console.log('Connecting to DB...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get Tenant ID
        const tenantRes = await client.query("SELECT id FROM public.tenants WHERE slug = 'primary'");
        if (tenantRes.rows.length === 0) {
            console.error('Primary tenant not found. Please run seed-primary-tenant.js first.');
            process.exit(1);
        }
        const tenantId = tenantRes.rows[0].id;

        // 2. Get or create the global owner role with platform-admin flags.
        const roleRes = await client.query(
            `SELECT id
             FROM public.roles
             WHERE lower(name) = 'owner'
               AND deleted_at IS NULL
             ORDER BY tenant_id NULLS FIRST, created_at ASC
             LIMIT 1`
        );
        let roleId;

        if (roleRes.rows.length === 0) {
            console.log('Owner role not found, creating global platform owner role...');
            const newRole = await client.query(
                `INSERT INTO public.roles (
                    tenant_id, name, description, scope,
                    is_system, is_platform_admin, is_full_access, is_tenant_admin
                 )
                 VALUES (NULL, 'owner', 'Full access owner role', 'platform', true, true, true, true)
                 RETURNING id`
            );
            roleId = newRole.rows[0].id;
        } else {
            roleId = roleRes.rows[0].id;
        }

        await client.query(
            `UPDATE public.roles
             SET scope = 'platform',
                 is_platform_admin = true,
                 is_full_access = true,
                 is_tenant_admin = true,
                 updated_at = NOW()
             WHERE id = $1`,
            [roleId]
        );

        await client.query(
            `INSERT INTO public.role_permissions (role_id, permission_id)
             SELECT $1, id
             FROM public.permissions
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM public.role_permissions rp
                 WHERE rp.role_id = $1
                   AND rp.permission_id = public.permissions.id
             )`,
            [roleId]
        );

        // 3. Create User in auth.users
        const email = 'cms@ahliweb.com';
        const password = 'Password123456@$#';
        const hashedPassword = await bcrypt.hash(password, 10);
        let userId = crypto.randomUUID();

        console.log(`Creating user ${email}...`);

        const existingAuthUser = await client.query(
            `SELECT id FROM auth.users WHERE email = $1 LIMIT 1`,
            [email]
        );

        if (existingAuthUser.rows.length > 0) {
            userId = existingAuthUser.rows[0].id;
            await client.query(
                `UPDATE auth.users
                 SET encrypted_password = $1,
                     email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
                     updated_at = NOW(),
                     raw_user_meta_data = '{"full_name": "System Owner"}'
                 WHERE id = $2`,
                [hashedPassword, userId]
            );
            console.log('Existing auth user updated:', userId);
        } else {

            // Insert into auth.users directly for local bootstrap.
            const userRes = await client.query(`
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change_token_current,
        email_change,
        phone_change,
        reauthentication_token,
        phone_change_token,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin
      ) VALUES (
        $1,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        $2,
        $3,
        NOW(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        NOW(),
        NOW(),
        '{"provider": "email", "providers": ["email"]}',
        '{"full_name": "System Admin"}',
        false
      )
      RETURNING id
    `, [userId, email, hashedPassword]);

            console.log('User created in auth.users:', userRes.rows[0].id);
        }

        // 4. Insert into public.users (Profile)
        const profileCheck = await client.query("SELECT id FROM public.users WHERE id = $1", [userId]);

        if (profileCheck.rows.length === 0) {
            console.log('Creating public profile...');
            await client.query(`
            INSERT INTO public.users (id, email, full_name, role_id, tenant_id)
            VALUES ($1, $2, 'System Owner', $3, $4)
        `, [userId, email, roleId, tenantId]);
        } else {
            console.log('Public profile already exists, updating role/tenant...');
            await client.query(`
            UPDATE public.users
            SET role_id = $1,
                tenant_id = $2,
                email = $4,
                full_name = 'System Owner'
            WHERE id = $3
        `, [roleId, tenantId, userId, email]);
        }

        await client.query('COMMIT');

        console.log(`\nSUCCESS! \nUser: ${email}\nPassword: ${password}\n`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating user:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

createAdminUser();
