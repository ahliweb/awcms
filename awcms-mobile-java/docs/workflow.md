# Contributing and Development Workflow

## Branching
- `feature/mobile-java-<topic>` for new features.
- `fix/mobile-java-<topic>` for bug fixes.
- `chore/mobile-java-<topic>` for tooling or docs.

## Code Style
- Follow the Google Java Style Guide.
- Run `./gradlew lint` before opening a PR.

## Pull Request Checklist
- [ ] Build passes (`./gradlew assembleDebug`).
- [ ] Unit tests pass (`./gradlew testDebugUnitTest`).
- [ ] Lint passes (`./gradlew lint`).
- [ ] Secrets removed from diffs.
- [ ] Docs updated when API contracts change.

## Context7 MCP Usage
- Use Context7 for library and API references when updating docs.
- Set `CONTEXT7_API_KEY` in `awcms/.env` before querying.
