# Folder Structure and Conventions

## Recommended Layout

```
awcms-mobile-java/
  app/
    src/main/java/com/awcms/mobile/
      core/
        auth/
        network/
        storage/
        tenant/
      data/
        local/
        remote/
        model/
        repository/
      domain/
        model/
        usecase/
      ui/
        feature/
        common/
    src/main/res/
      layout/
      drawable/
      mipmap/
      values/
      navigation/
    src/test/java/
    src/androidTest/java/
  docs/
```

## Naming Conventions
- **Packages**: `com.awcms.mobile` or tenant-specific reverse domain.
- **Classes**: PascalCase (e.g., `LoginViewModel`).
- **Resources**: `snake_case` (e.g., `activity_login.xml`).
- **Layouts**:
  - `activity_*.xml` for Activities.
  - `fragment_*.xml` for Fragments.
  - `item_*.xml` for RecyclerView rows.
- **Drawables**: prefix by type (e.g., `ic_`, `bg_`, `shape_`).

## Conventions
- Keep feature-specific UI inside `ui/feature/<feature-name>`.
- Repositories are the only layer that talks to remote/local data sources.
- Do not place secrets in code; use `secrets.properties` and `BuildConfig`.
