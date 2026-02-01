/// <reference types="astro/client" />

declare module '*.json' {
  const value: any;
  export default value;
}

interface ImportMetaEnv {
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
