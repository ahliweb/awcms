🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0005-soft-delete-and-immutability.id.md)

# ADR-0005 — Soft delete for master/config, immutability for posted data

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `docs/awcms/04_erd_data_dictionary.md`, `docs/awcms/10_template_kode_coding_standard.md` (§Soft delete helper)

## Context

Deleting rows physically destroys the audit trail and breaks references. Conversely, data representing an event that has already happened (e.g. a transaction posted by a derived application) must not be changed retroactively.

## Decision

We decided on two complementary rules:

1. **Soft delete** is mandatory for tenant-scoped master/config/draft resources: fill in `deleted_at`, `deleted_by`, `delete_reason`; list/detail queries filter `deleted_at IS NULL` by default; restore/purge are high-risk actions (they need a permission and are audited).
2. **Immutability** for data that is already posted/append-only (when a derived application has it): corrections go through a reversal/adjustment as a new row, not an overwrite/delete. Audit logs, security events, and sync conflicts are also not soft-deleted.

## Consequences

- **Positive:** the audit trail stays intact, data can be recovered, references do not break, corrections are transparent.
- **Trade-off:** queries must include the soft delete filter; extra columns & indexes are needed; purge needs a separate retention/legal path.
- **Neutral:** a partial unique index `WHERE deleted_at IS NULL` for business keys that may be reused after being archived.

## Alternatives considered

- **Hard delete everywhere** — rejected: destroys the audit and referential integrity.
- **Immutability for every table** — rejected: master/config legitimately changes; only event data is immutable.
