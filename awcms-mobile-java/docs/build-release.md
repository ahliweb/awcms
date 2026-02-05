# Build and Release Process

## Debug Builds
- `./gradlew assembleDebug`
- `./gradlew installDebug`

## Release Builds
1. Create a keystore and `keystore.properties`:
```
storeFile=keystore.jks
storePassword=...
keyAlias=awcms
keyPassword=...
```
2. Configure `signingConfigs` in `build.gradle`.
3. Build the release bundle:
- `./gradlew bundleRelease`
- `./gradlew assembleRelease`

## Versioning
- Increment `versionCode` for every release.
- Update `versionName` to match release tags.

## CI Notes
- Set `ANDROID_SDK_ROOT` and `JAVA_HOME` in CI.
- Cache Gradle and Android SDK directories.
- Run `./gradlew lint testDebugUnitTest` before publishing artifacts.
