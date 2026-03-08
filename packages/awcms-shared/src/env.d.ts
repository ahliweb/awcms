interface ImportMetaEnv {
    readonly PUBLIC_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_URL?: string;
    readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly PUBLIC_TENANT_ID?: string;
    readonly VITE_PUBLIC_TENANT_ID?: string;
    readonly VITE_TENANT_ID?: string;
}

interface ImportMeta {
    readonly env?: ImportMetaEnv;
}
