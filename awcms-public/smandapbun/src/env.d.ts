/// <reference types="astro/client" />

declare module '*.json' {
  const value: any;
  export default value;
}

interface ImportMetaEnv {
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    tenant_id: string;
    tenant_slug: string;
    host: string;
    tenant_source: "path" | "host";
    ref_code: string | null;
    locale: string;
    analytics_consent?: Record<string, unknown>;
    runtime?: {
      env?: Record<string, any>;
    };
  }
}

