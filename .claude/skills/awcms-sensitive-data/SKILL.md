---
name: awcms-sensitive-data
description: Tangani data sensitif AWCMS (email, phone, WhatsApp, NPWP, NIK, NITKU, receipt token) dengan normalize, hash lookup, dan masking. Gunakan saat menyimpan/menampilkan identifier, membuat profile identifier, atau menyusun DTO/response/log. Sesuai doc 04.
---

# AWCMS — Sensitive Data Handling

Ikuti `docs/awcms/04_erd_data_dictionary.md` (klasifikasi & masking).

## Pipeline identifier

```mermaid
flowchart LR
  In[Raw identifier] --> Norm[Normalisasi] --> Hash[value_hash - lookup/dedup unik]
  Norm --> Mask[masked_value - tampilan]
  Hash & Mask --> DB[(Simpan)]
  DB -. tidak pernah .-> Raw[Response/log/audit mentah]
```

## Aturan

1. Simpan `normalized_value`, `value_hash`, `masked_value`. Unik `(tenant_id, identifier_type, value_hash)`.
2. Response umum hanya tampilkan `masked_value`; nilai penuh hanya untuk role berwenang lewat `awcms-abac-guard`.
3. **Jangan** kirim raw value ke response/log/audit/event.
4. Gunakan `normalizeIdentifier`/`hashIdentifier`/`maskIdentifier`
   (`src/modules/profile-identity/domain/identifier.ts`) untuk mengubah
   raw value → safe DTO — dipanggil langsung dari caller (mis.
   `identity-access/application/password-reset.ts`,
   `email/application/suppression-directory.ts`), **tidak** ada layer
   mapper terpisah (`infrastructure/mappers.ts` tidak pernah dibangun;
   sebagian besar modul bahkan tidak punya folder `infrastructure/`).
5. Receipt token: non-sequential, tidak mudah ditebak.
6. Password hanya hash modern; `password_hash` tidak pernah keluar.

## Klasifikasi

| Data                         | Level       | Kontrol                   |
| ---------------------------- | ----------- | ------------------------- |
| Password hash, API key/token | Critical    | Never expose / env only   |
| NPWP/NIK/NITKU               | High        | Mask + ABAC tax role      |
| Phone/WhatsApp/email         | High        | Mask + hash lookup        |
| Address                      | Medium/High | Need-to-know              |
| Tax invoice/XML              | High        | Tax role, audit, checksum |

## Verifikasi

- Response/log tidak memuat nilai sensitif penuh.
- Duplicate identifier tidak membuat profile baru (dedup via hash).
- Konsisten dengan redaction logger & `awcms-audit-log`.
