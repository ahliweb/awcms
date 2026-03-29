# ABAC Rename Notes

This note tracks the intentional scope of the `RBAC` to `ABAC` terminology cleanup.

## Renamed Surfaces

- Extensions module route/UI state and labels
- Extension ABAC components and user-facing copy
- Locale keys used by the Extensions module UI
- Related docs and tests where the rename is purely semantic and does not affect storage contracts

## Intentionally Preserved Legacy Names

The following legacy schema/database identifiers should remain unchanged unless migrated explicitly with backward-compatibility handling:

- `public.extension_rbac_integration`
- related indexes, triggers, constraints, and policy names tied to that table
- any historical schema snapshots such as `db_schema.sql` and remote schema dumps that mirror live database state

## Reasoning

- UI/code/docs can safely move to `ABAC` terminology.
- database object renames are a separate risk class and should only be done with mirrored migrations, dependency review, and compatibility validation.
