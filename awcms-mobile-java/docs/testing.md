# Testing Guidelines

## Unit Tests
- Location: `app/src/test/java`
- Framework: JUnit + Mockito
- Command: `./gradlew testDebugUnitTest`

## Instrumentation Tests
- Location: `app/src/androidTest/java`
- Framework: AndroidX Test + Espresso
- Command: `./gradlew connectedDebugAndroidTest`

## Test Data
- Use a dedicated Supabase test tenant.
- Seed data with fixtures and keep IDs stable.
- Mock network responses with MockWebServer for unit tests.

## Devices
- Minimum API 26 emulator for smoke tests.
- Validate at least one physical device before release.
