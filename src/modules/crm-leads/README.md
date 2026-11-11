🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `crm_leads`

The reusable **lead/prospect pipeline** (Issue #1166, [ADR-0153](../../../docs/adr/0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.md)). A **pre-customer** context: it owns the lead and nothing else. It never owns the customer (only an opaque `external_customer_ref` written by a conversion), never creates a `profile_identity` profile, never stores or infers consent, sends nothing and imports nothing from a downstream product.

- **Off at three levels**: `CRM_LEADS_ENABLED` (deployment, `503` after authorization), Module Management (per tenant), and the module's own tenant switch (`PATCH /api/v1/crm-leads/settings`, default off; lead writes answer `409 CRM_LEADS_TENANT_DISABLED`).
- **Versioned stage catalog**: a pipeline has immutable revisions (stages with a tenant-chosen key and name and a CLOSED category `new`, `working`, `qualified`, `converted`, `lost`, `disqualified`; allowed edges with guards from a closed set `owner_assigned`, `contact_point_present`, `reason_required`). The database refuses any change to a published revision. A revision that removes an occupied stage needs an explicit `stageMigrations` map; each moved lead gets a `stage_migrated` transition.
- **Intake** (`manual`, `import`, `api`): idempotent on the `Idempotency-Key` and on the source key `(kind, channel account, externalEventId)`, serialised by an advisory lock. The first source touch is immutable; later touches are appended.
- **Transitions**: append-only, each naming the revision it happened under; moves are decided under the pipeline-then-lead row locks with `expectedVersion`, the edge and its guards re-checked in the transaction.
- **Contact points**: AES-256-GCM ciphertext + per-tenant, per-kind keyed hash + masked form (`CRM_LEADS_KEYS`). Every response is masked; no endpoint decrypts. Lookup is an exact hash match inside one tenant.
- **Candidates and merge**: candidates are exact hash matches in one tenant, never a merge. A merge is human-verified (note, both versions), idempotent, audited, same pipeline only, and undoable within the tenant's window (`mergeUndoHours`, default 168).
- **Conversion**: recorded from the authority (`authority_confirmed`, opaque customer reference, idempotent on `evidenceRef`) or a flagged manual path (`authority_unconfirmed`, separate permission, note required); reversed by a stamped reversal plus a new transition, never by editing history.
- **Erasure**: `POST /leads/{id}/anonymize` erases name, contact points, reasons and notes; stage, touches, transition and conversion facts stay so funnel counts do not change. Mutation responses never carry the display name, so the stored idempotency replay cannot outlive an erasure.
- **Events** (outbox, AsyncAPI): `awcms.crm_leads.lead.{created,stage_changed,assigned,merged,merge_reverted,converted,conversion_reversed,lost}`, opaque ids and attribution references only, `privacyClass: pseudonymous`.
- **Port**: `CrmLeadPort` (`_shared/ports/crm-lead-port.ts`, capability `crm_lead` 1.0.0) for a downstream authority to read lead state and confirm or reverse a conversion.
- **Tables** `sql/342`, permissions `sql/343`, integrity triggers `sql/344`; RLS `FORCE` everywhere, composite tenant foreign keys, no `DELETE` for `awcms_app`, no grant at all for `awcms_worker`.

## Permission mapping (ADR-0153 working name → seeded key)

| ADR-0153               | Seeded                                                   |
| ---------------------- | -------------------------------------------------------- |
| `leads.read`           | `crm_leads.leads.read`                                   |
| `leads.create`         | `crm_leads.leads.create`                                 |
| `leads.update`         | `crm_leads.leads.update`                                 |
| `leads.assign`         | `crm_leads.leads.assign`                                 |
| `leads.delete` (soft)  | `crm_leads.leads.delete` (soft delete and anonymise)     |
| (restore)              | `crm_leads.leads.restore`                                |
| `leads.move`           | `crm_leads.stages.update`                                |
| `leads.merge`          | `crm_leads.merges.manage`                                |
| `pipeline.configure`   | `crm_leads.pipelines.configure` (also the tenant switch) |
| `conversion.confirm`   | `crm_leads.conversions.approve`                          |
| `conversion.manual`    | `crm_leads.manual_conversions.create`                    |
| `leads.export`         | not seeded: export is deferred (no route would check it) |
| `milestones.configure` | not seeded: milestones are deferred                      |

## Deferred (recorded, not built in this slice)

- Admin screen (the module is `experimental` with no navigation entry; permissions are in `NOT_YET_SCREENED`).
- `website_form` intake through the `website_engagement.submission.received` subscription and the `inbound_message` tenant rule (O8); both source kinds are refused over HTTP until their consumers exist.
- CSV import/export with formula neutralisation (T-X1) and `leads.export`; milestones; typed extensions (O9 recommends no `pii` extensions in v1); consent references and `lead.consent_changed`; notes; the optional `profile_id` link (O6).
- The reporting projection with definition version and business-zone buckets (T-R1); the transition table carries the facts and the funnel index it needs.
- Retention sweep (O4): the tables answer `BOUNDED_BY_DESIGN` with this follow-up named, because an age-based `generic` purge would delete converted leads and cannot respect the append-only children.
- A contact-point rekey job; until it exists, only ADD keys to `CRM_LEADS_KEYS`.
- Machine-credential intake (`api` by an integration without a person) and owner- or scope-restricted access (every permission is tenant-wide today; a business scope on a pipeline is an opaque reference, not yet an ABAC fact).

## Open decisions (fail-closed choices made here)

- Mutations refuse machine credentials (accountable person required).
- A merge is allowed only inside one pipeline (stricter than "the same business scope").
- A converted lead cannot be absorbed by a merge; reversal does not need an allowed edge (it is a correction), and an anonymised or merged lead keeps its stage on reversal.
- No decrypt/reveal endpoint: staff see masked contact points only until the maintainer admits one with its own permission.
