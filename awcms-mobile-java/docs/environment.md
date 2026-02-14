# Environment Configuration

## Secrets Handling

- Store secrets in `secrets.properties` (local only).
- Do not commit `secrets.properties` or `local.properties`.
- Map secrets into `BuildConfig` via Gradle.

## Required Keys

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
```

## Optional Keys

```
SUPABASE_PROJECT_ID=...
SUPABASE_FUNCTIONS_URL=https://<project>.supabase.co/functions/v1
TURNSTILE_SITE_KEY=... (only if a mobile form uses Turnstile)
TENANT_ID=... (dev override)
```

## Gradle Example

```
def secrets = new Properties()
file("secrets.properties").withInputStream { secrets.load(it) }

android {
  defaultConfig {
    buildConfigField "String", "SUPABASE_URL", "\"${secrets['SUPABASE_URL']}\""
    buildConfigField "String", "SUPABASE_PUBLISHABLE_KEY", "\"${secrets['SUPABASE_PUBLISHABLE_KEY']}\""
  }
}
```

## Runtime Overrides

- Use a debug-only settings screen to switch tenants.
- Never expose service role keys or admin credentials on device.
