# Deployment Cells — Storage Contract

**Spec reference:** §13 R2 Storage and Media Metadata Contract

---

## Canonical Object Key Pattern

```
{project_code}/{environment}/{tenant_id}/{module}/{object_id}/{variant_or_filename}
```

**Example:**
```
sikesra/production/550e8400-e29b-41d4-a716-446655440000/media/b5e300aa.../original.jpg
```

All segments are lowercase and trimmed. Filename case is preserved.

**Source:** `src/lib/storage/objectKeys.js` → `generateObjectKey()`

---

## Visibility Classes

| Class | Worker-Mediated | Cache | Audit |
|---|---|---|---|
| `public` | No | `max-age=31536000, immutable` | No |
| `private` | **Yes** (short-lived grant) | `no-store` | No |
| `restricted` | **Yes** (explicit permission) | `no-store` | **Yes** |

**Source:** `src/lib/storage/mediaPolicies.js` → `getAccessPolicy()`

---

## Upload Completion Rule (§13.4)

An upload is **not canonical** until all four conditions are met:

1. Object exists in R2 (Worker confirms `r2Confirmed = true`)
2. Metadata row exists with all required fields
3. Object linked to a tenant/module record (`object_id` set)
4. `visibility_class` and `retention_class` are set

**Validate with:** `isUploadComplete(metadata, r2Confirmed)` in `mediaPolicies.js`

---

## Required Media Metadata Fields

`id`, `tenant_id`, `project_id`, `module`, `object_id`, `object_key`, `visibility_class`, `retention_class`, `content_type`, `size_bytes`, `status`, `created_by`, `created_at`
