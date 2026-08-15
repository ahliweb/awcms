🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](privacy-analysis.id.md)

# Privacy analysis (step 3 of the development flow)

> **What this document answers:** what personal data THIS TEMPLATE holds,
> on what basis it is kept for as long as it is, and where that claim is **enforced**
> rather than merely stated.
>
> **What this document does NOT answer, and cannot:** the legal basis for processing,
> DPO appointment, data processor agreements, and cross-jurisdiction transfers.
> All of those are facts about the **deployment and the organisation using it**,
> not about the code. A template that pretends to answer them would
> give the operator a sense of safety it bought them nothing.

- **Flow step:** 3 ([`alur-pengembangan.md`](alur-pengembangan.md)).
- **Its counterpart:** [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md)
  answers "who is the attacker"; this document answers "whose data is in
  here". Both are step 3 and both are mandatory.
- **Per-feature template:** [`templates/privacy-analysis-template.md`](templates/privacy-analysis-template.md).

## 1. The rule that keeps this document from going stale

Every claim below points at a place that is **gated**. That is not a writing
style — it is the only reason this page can still be trusted six months from now.

| Kind of claim                   | Where it is enforced                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| how long data is kept           | per-table `dataLifecycle` descriptor + `data-lifecycle:table-coverage:check` — **every table must answer**, and one that does not answer reddens the build |
| what must never end up in a log | `_shared/redaction.ts`, called by `recordAuditEvent` before the INSERT                                                                                     |
| who may read what               | RLS `FORCE` + default-deny chokepoint (`security:readiness`, `access:chokepoint:check`)                                                                    |
| whether a new table was missed  | it cannot be: an `awcms_%` table without RLS must be listed with a reason in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`                                           |

This page **deliberately does not** copy the per-table retention numbers. Such a copy would go
stale on the first day someone changes the descriptor, and a stale number in
a privacy document is more dangerous than no number at all.

## 2. Categories of personal data this base holds

Derived from the real schema, not from memory.

### 2.1 Identity and credentials

| Data                       | Where                                                                    | Notes                                                                                             |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| login address (email)      | `awcms_identities.login_identifier`, `awcms_principals.email_normalized` | Since ADR-0085 the address also lives **globally** — one human, one principal row, across tenants |
| password hash              | `awcms_principals.password_hash`                                         | A hash, never plaintext. The per-tenant column becomes a leftover                                 |
| display name / legal name  | `awcms_profiles.display_name`, `legal_name`                              | Filled in by humans; the template does not validate its shape                                     |
| MFA secret + recovery code | `awcms_principal_mfa_factors`, `awcms_principal_mfa_recovery_codes`      | Encrypted (`sql/024` construction), global since ADR-0087                                         |

**The consequence the operator must read:** the three tables above are **GLOBAL, without
RLS** (ADR-0085/0087). Their isolation is not RLS but four substitute controls,
one of them the `identity:principal-access:check` gate that limits which files
may mention those tables at all.

### 2.2 Activity and traces

| Data                    | Where                      | Notes                                                                                    |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| audit trail of actions  | `awcms_audit_events`       | `attributes` is **redacted before the INSERT** (`_shared/redaction.ts`)                  |
| authorization decisions | `awcms_abac_decision_logs` | The largest table in the repo; only policy codes + static reasons, no attribute values   |
| sessions                | `awcms_sessions`           | A token hash, not the token                                                              |
| visitor analytics       | `awcms_visitor_*`          | `ip_hash` / `user_agent_hash` / `visitor_key_hash`, **salted HMAC** — not the raw values |

The redaction keys in force today live in `REDACTION_KEYS`
(`src/modules/_shared/redaction.ts`) and cover, among others, `password`,
`token`, `secret`, `npwp`, `nik`, `phone`, `whatsapp`, `email`, `cookie`, plus
IP address synonyms matched **exactly** (`ip`, `clientip`, `xforwardedfor`)
— a substring match would wreck `description` and `shipping`.

### 2.3 Data entered by end users

`awcms_comments`, `awcms_form_drafts`, and the domain modules added in
`src/modules/`. **This base does not know what will be entered there**, and
that is exactly why the per-feature template below demands the answer per feature instead
of guessing here.

### 2.4 Cross-organisation data (Wave 8)

Since ADR-0090, a human from ANOTHER organisation can become a member of a
tenant. The privacy consequences are stated here so they are not discovered later:

- that person's address **enters** the target tenant's `awcms_identities` at redemption time;
- every action of theirs carries `actor_tenant_id` + `delegated_grant_id`
  (ADR-0091), so the customer can answer "what did our vendor do";
- the platform operator's id **deliberately does not** cross over into the customer's log — it is an
  opaque uuid they cannot resolve and at the same time a third party's identifier.

## 3. The three questions EVERY new feature must answer

This is what step 3 amounts to for a change, and the answers go into its PR:

1. **What personal data does this feature collect or display that was not
   previously in the system?** "None" is a valid and most often
   correct answer — but it must be written down, not assumed.
2. **How long is it kept, and what DELETES it?** If the answer is
   a new table, its `dataLifecycle` descriptor is the answer and
   the gate already demands it. If the answer is "forever", that is a decision that
   must be visible.
3. **Who can see it, and what stops everyone else?** For
   tenant-scoped data, the answer is RLS + chokepoint. For anything GLOBAL,
   the answer must be longer and usually means an ADR.

## 4. Data subject rights — the template's position, stated honestly

| Right                 | What this base provides                                                                                                         | What is missing         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| access / portability  | per-table `subjectData` descriptor + two gates, **and the export endpoint** (`POST …/subject-requests/export`, ADR-0094 wave 2) | —                       |
| erasure               | a **maker/checker** "erase this person" flow (`…/erase` + `…/{id}/decide`), five per-table erasure modes                        | —                       |
| rectification         | admin surfaces for profiles and identities                                                                                      | —                       |
| restriction/objection | deactivating a tenant user + revoking sessions                                                                                  | no per-purpose flagging |

**CORRECTION 13 August 2026.** The first two rows of this table previously read
"the export endpoint does not exist yet" and "there is no erase-this-person flow yet". Both
**have been built** by Issue #557 — do not build them again, and do not quote an
older version of this document as evidence of a gap.

**The ordering was deliberate, and that is the part worth remembering.** #542 landed
the foundation first and left **139 tables in the debt ledger**; #557 refused
to land an endpoint on top of that ledger, because an export that answers with 3
tables and stays silent about the remaining 139 is a report that is **signed and
incomplete** — worse than no report at all. So #557 paid the debt off
in full first: **139 → 0** (147 tables = 140 with a descriptor + 7 rejected
with a reason), and only then built the surface.

The consequence for today's reader: the question _which tables a request must
answer_ — the part that is most expensive if built later — is already
answered for the entire schema, and guarded by two gates that ask different
things: `subject-data:coverage:check` (does every table answer) and
`subject-data:registry:check` (is the answer correct against `sql/`).
The export **states its own coverage**: tables deliberately left unanswered
(global, or without a subject column) are named in the report too, because a
per-tenant report that silently drops `awcms_principals` cannot be told apart
from a report written before that table existed.

Erasure is **maker/checker** (ADR-0094 Decision 3): the requester can
never approve their own request, enforced in four layers — two
separate permissions, a `critical` SoD rule, a CHECK constraint, and one conditional
UPDATE. Export and erasure are **two different authorities**: holding
the right to read is not a reason to hold the right to destroy.

The subject is a **tenant user, answered per tenant**. There is no single
"forget me everywhere" button, and that is not a simplification: each tenant is a
separate data controller, and FORCE RLS models the correct thing.

## 5. What only the operator can answer

- The legal basis for each processing activity.
- Whether that organisation is a controller or a processor, and the agreements that come with it.
- Storage location and cross-jurisdiction transfers — a deployment fact
  ([`environments.md`](environments.md)), not a code fact.
- Breach notification obligations and their deadlines.
- The **actual** retention chosen: the descriptor has `retentionMinDays`/`MaxDays`
  and a default; the number in force is the one the deployment sets.
