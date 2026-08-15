🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](privacy-analysis-template.id.md)

# Privacy analysis — <feature/module name>

- **Issue / PR:** `#<nnn>` · **Date:** `<date>` · **Author:** `<name>`
- **Change class:** `<see the table in alur-pengembangan.md>`

> Filling this in is step 3 for one change. If all three answers below are "no
> new personal data", one paragraph is enough and that is a normal outcome —
> this list exists so that the answer gets **written down**, not so that it gets
> long.

## 1. What personal data is new?

What this change collects, displays, or forwards outside, and that was not
previously in the system.

| Data | In which column/table | From whom | Seen by whom |
| ---- | --------------------- | --------- | ------------ |

If empty: write "none", and go on to §4.

## 2. For how long, and what deletes it?

- A new table → its `dataLifecycle` descriptor (the `data-lifecycle:table-coverage:check` gate demands it).
- A new column on an existing table → its retention follows the table's; **check whether that is still correct** for this new data.
- "Forever" → a decision that must be visible, with its reasoning.

## 3. Who can see it?

- Tenant-scoped → RLS + chokepoint; name the permission.
- **GLOBAL/no RLS** → almost always an ADR. Name the compensating control.
- Leaving the system (email, webhook, provider) → say where to and what it carries.

## 4. Redaction and logs

Can the new value land in `awcms_audit_events`, the decision log, or the
application log? If so, is its key already covered by `REDACTION_KEYS`
(`src/modules/_shared/redaction.ts`)? A new key name that matches no pattern is
**not** redacted.

## 5. Data subject rights

Does this change create data that must be exportable or deletable on request? If
so, note that this base does **not** yet have a per-subject flow
([`../privacy-analysis.md`](../privacy-analysis.md) §4) and how the operator
handles it in the meantime.
