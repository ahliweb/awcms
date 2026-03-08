# AWCMS Extensions

## Purpose

External extension packages for AWCMS.

## Notes

- Extensions should follow the permission-key format `scope.resource.action`.
- Keep tenant-aware behavior aligned with `docs/modules/EXTENSIONS.md` and the root `AGENTS.md` guardrails.
- Do not commit secrets or local `.env` files inside extension packages.
- The current maintained package is `awcms-ext/primary-analytics/`; CI validates it with `npm run build:ci` from that directory.

## Structure

```text
awcms-ext/
  awcms-ext-{vendor}-{slug}/
    manifest.json
    package.json
    src/
```

## References

- `../docs/modules/EXTENSIONS.md`
- `primary-analytics/package.json`
- `../DOCS_INDEX.md`
