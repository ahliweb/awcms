import { getTenantId } from "@awcms/shared/tenant";

export const getPublicTenantId = (): string | null => getTenantId();
