const workerBaseUrl = process.env.AWCMS_EDGE_BASE_URL || 'http://127.0.0.1:8787';
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const smandapbunTenantId = process.env.AWCMS_SMANDAPBUN_TENANT_ID || 'd2d84ae5-f89d-4147-b230-5b44e7b2da7b';
const primaryTenantId = process.env.AWCMS_PRIMARY_TENANT_ID || '91432330-6fec-4371-bbba-936ac7e5da76';

if (!serviceKey) {
  throw new Error('SUPABASE_SECRET_KEY is required to run the manage-users smoke test');
}

const restHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

const getJson = async (url) => {
  const response = await fetch(url, { headers: restHeaders });
  if (!response.ok) {
    throw new Error(`Failed GET ${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const getRoleId = async ({ tenantId, name }) => {
  const url = `${supabaseUrl}/rest/v1/roles?select=id&tenant_id=eq.${tenantId}&name=eq.${name}&deleted_at=is.null&limit=1`;
  const rows = await getJson(url);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Role not found for tenant ${tenantId}: ${name}`);
  }
  return rows[0].id;
};

const invokeManageUsers = async (payload) => {
  const response = await fetch(`${workerBaseUrl}/functions/v1/manage-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

const createBootstrapUser = async () => {
  const smandapbunAdminRoleId = await getRoleId({ tenantId: smandapbunTenantId, name: 'admin' });
  const primaryAdminRoleId = await getRoleId({ tenantId: primaryTenantId, name: 'admin' });
  const email = `admin+smandapbun-${Date.now()}@example.com`;

  const createResponse = await invokeManageUsers({
    action: 'create',
    email,
    password: 'Password123!',
    full_name: 'SMANDAPBUN Bootstrap Admin',
    tenant_id: smandapbunTenantId,
    role_id: smandapbunAdminRoleId,
  });

  if (createResponse.status !== 200 || !createResponse.data?.user?.id) {
    throw new Error(`Expected successful user creation, received ${createResponse.status}: ${JSON.stringify(createResponse.data)}`);
  }

  const mismatchResponse = await invokeManageUsers({
    action: 'create',
    email: `mismatch+smandapbun-${Date.now()}@example.com`,
    password: 'Password123!',
    full_name: 'Role Mismatch User',
    tenant_id: smandapbunTenantId,
    role_id: primaryAdminRoleId,
  });

  if (mismatchResponse.status === 200 || !String(mismatchResponse.data?.error || '').includes('Role does not belong to the target tenant')) {
    throw new Error(`Expected tenant-role validation failure, received ${mismatchResponse.status}: ${JSON.stringify(mismatchResponse.data)}`);
  }

  console.log(JSON.stringify({
    createdUserId: createResponse.data.user.id,
    email,
    tenantId: smandapbunTenantId,
    roleId: smandapbunAdminRoleId,
    mismatchGuard: 'ok',
  }, null, 2));
};

createBootstrapUser().catch((error) => {
  console.error(error);
  process.exit(1);
});
