// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="vite/client" />
/// <reference types="../vendor/integration/types.d.ts" />

declare namespace App {
  interface Locals {
    tenant_id: string;
    tenant_slug: string;
    host: string;
    tenant_source: "path" | "host";
    ref_code: string | null;
    locale: string;
    runtime: {
      env: Record<string, string>;
    };
  }
}
