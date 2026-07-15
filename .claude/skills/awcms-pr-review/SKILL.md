---
name: awcms-pr-review
description: Review pull request AWCMS terhadap Definition of Done dan kontrak proyek. Gunakan saat diminta review PR/diff AWCMS. Memeriksa scope atomic, migration/OpenAPI/AsyncAPI sinkron, tenant/ABAC/RLS, idempotency, audit, masking, test, dan docs sesuai doc 09, 10, 12.
---

# AWCMS — PR Review

Ikuti `docs/awcms/12_generator_prompt.md` (Prompt Review PR), `docs/awcms/09_roadmap_repository_commit.md` (PR checklist), dan `docs/awcms/10_template_kode_coding_standard.md`.

## Fokus review

1. Scope sesuai issue; **tidak ada unrelated change**.
2. No secret / data customer asli / dump DB / `.env`.
3. Schema berubah → ada migration berurutan (`awcms-new-migration`).
4. API berubah → OpenAPI diperbarui (`awcms-new-endpoint`).
5. Event berubah → AsyncAPI diperbarui (`awcms-new-event`).
6. Tenant context + ABAC + RLS untuk data tenant-scoped.
7. Idempotency untuk mutation high-risk.
8. Audit high-risk + redaction.
9. Soft delete policy untuk resource deletable; posted/append-only entity tidak dihapus.
10. Input validation lengkap; error response standar.
11. Sensitive data masked.
12. Test relevan ada & pass; build pass.
13. Docs diperbarui; commit mengikuti convention `<type>(<scope>): <summary>`.

## Konsistensi kontrak

- Migration ↔ ERD (doc 04) ↔ matrix migration (doc 13).
- Endpoint ↔ OpenAPI ↔ tabel error/header (doc 05).
- Event ↔ AsyncAPI ↔ `module.ts` publishes/subscribes.
- Soft delete ↔ ERD kolom/index ↔ OpenAPI DELETE/restore/includeDeleted ↔ audit event.

## Output

```text
Verdict: Approve / Request changes / Comment only
Critical issues:
Security issues:
Functional issues:
Data/migration issues:
API/event contract issues:
Testing gaps:
Documentation gaps:
Suggested patch:
```

Untuk modul sensitif, jalankan juga `awcms-security-review`.
