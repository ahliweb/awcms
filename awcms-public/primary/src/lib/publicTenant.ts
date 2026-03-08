import { getTenantId } from "@awcms/shared/tenant";

type PublicTenantEnv = {
  PUBLIC_TENANT_ID?: string;
  VITE_PUBLIC_TENANT_ID?: string;
  VITE_TENANT_ID?: string;
};

export const getPublicTenantId = (
  env: PublicTenantEnv = import.meta.env as PublicTenantEnv,
): string | null => {
  const tenantIdFromEnv =
    env.PUBLIC_TENANT_ID ||
    env.VITE_PUBLIC_TENANT_ID ||
    env.VITE_TENANT_ID ||
    null;

  return getTenantId(tenantIdFromEnv);
};
