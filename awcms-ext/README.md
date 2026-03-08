# AWCMS Extensions

## Purpose

External extension packages for AWCMS.

## Notes

- Extensions should follow the permission-key format `scope.resource.action`.
- Keep tenant-aware behavior aligned with `docs/modules/EXTENSIONS.md` and the root `AGENTS.md` guardrails.
- Do not commit secrets or local `.env` files inside extension packages.

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
- `../DOCS_INDEX.md`
