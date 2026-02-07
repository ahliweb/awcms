const TENANT_ID_KEYS = [
  "PUBLIC_TENANT_ID",
  "VITE_PUBLIC_TENANT_ID",
  "VITE_TENANT_ID",
];

export const getPublicTenantId = (): string | null => {
  const env = import.meta.env as Record<string, string | undefined>;

  for (const key of TENANT_ID_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
};
