/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        tenant_id: string;
        tenant_slug: string;
        tenant_source: 'host' | 'path';
        host: string;
        runtime?: {
            env: {
                VITE_SUPABASE_URL?: string;
                VITE_SUPABASE_ANON_KEY?: string;
                [key: string]: any;
            }
        };
    }
}

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_DEV_TENANT_HOST?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
