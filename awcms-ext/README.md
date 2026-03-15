# AWCMS Extensions

## Purpose

External extension packages for AWCMS.

## Notes

- Extensions should follow the permission-key format `scope.resource.action`.
- Keep tenant-aware behavior aligned with `docs/modules/EXTENSIONS.md` and the root `AGENTS.md` guardrails.
- Do not commit secrets or local `.env` files inside extension packages.
- The current maintained reference package is `awcms-ext/ahliweb/events/`; legacy analytics assets remain for compatibility.

## Structure

```text
awcms-ext/
  <vendor>/
    <slug>/
      extension.json
      README.md
      CHANGELOG.md
      admin/
      public/
      edge/
      shared/
      supabase/
      docs/
```

## References

- `../docs/modules/EXTENSIONS.md`
- `primary-analytics/package.json`
- `../DOCS_INDEX.md`
