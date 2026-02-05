# Troubleshooting

## Gradle Sync Fails
- Check `local.properties` for `sdk.dir`.
- Ensure Android SDK 34 and Build Tools 34.0.0 are installed.
- Clear cache: `./gradlew --stop` and re-sync.

## "SDK location not found"
- Create or update `local.properties` with the SDK path.

## 401/403 from Supabase
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Confirm access tokens are refreshed.
- Check tenant scoping headers.

## 5xx Errors from Functions
- Verify Edge Function name and payload.
- Check Supabase logs and function deployments.

## Dex or Method Count Errors
- Enable multidex or reduce dependencies.

## Release Build Fails
- Ensure `keystore.properties` is present.
- Validate signing config paths and passwords.
