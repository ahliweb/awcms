# AWCMS Mobile Java

## Purpose
Native Android (Java) client for AWCMS tenants. This module complements the
Flutter app by providing a Java-only Android stack that integrates with the
same Supabase backend, tenant rules, and permission model.

## Prerequisites
- Android Studio 2024.1+ (Koala or later)
- JDK 17
- Android SDK Platform 34 and Build Tools 34.0.0
- Gradle 8.x (via wrapper)
- Emulator or device on Android 8.0+ (API 26+)

## Local Setup
1. `cd awcms-mobile-java`
2. Open the folder in Android Studio.
3. Ensure `local.properties` contains your `sdk.dir`.
4. Create `secrets.properties` (see `docs/environment.md`).
5. Sync Gradle and run the app.

## Build and Run
- Debug build: `./gradlew assembleDebug`
- Install debug: `./gradlew installDebug`
- Unit tests: `./gradlew testDebugUnitTest`
- Instrumentation tests: `./gradlew connectedDebugAndroidTest`

## Documentation
- `docs/architecture.md`
- `docs/folder-structure.md`
- `docs/environment.md`
- `docs/api-integration.md`
- `docs/security.md`
- `docs/build-release.md`
- `docs/testing.md`
- `docs/workflow.md`
- `docs/troubleshooting.md`

## References
- `docs/dev/mobile.md`
- `docs/deploy/overview.md`
- `docs/tenancy/overview.md`
