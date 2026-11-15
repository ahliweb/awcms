🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0164-descriptor-declared-email-categories-whatsapp-templates-and-a-data-driven-worker-category-allow-list.id.md)

# ADR-0164 — E-mail categories and WhatsApp templates are declared in the module descriptor, and the worker category allow-list is data

- **Status:** Proposed (pending maintainer review)
- **Date:** 2026-11-15
- **Decision maker:** ahliweb (owner), to confirm
- **Resolves:** Issue #1277.
- **Extends:** [ADR-0134](0134-descriptor-declared-domain-event-consumers.md) (the model: a module declares what it owns, a central engine reads `listModules()`), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md) section 4 (module-prefixed WhatsApp templates), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (a template is used directly, so no upstream-owned file may need a downstream edit).
- **Related:** `sql/302` (the guard being made data), `sql/109` and `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (the read-only global table precedent), `src/modules/_shared/extension-point-declarations.ts`, `scripts/extension-points-check.ts`.

## Context

Three extension points of `email` and `whatsapp_delivery` were each reachable only by editing an upstream-owned file, and each failed silently:

1. **Derived e-mail categories.** `registerDerivedEmailTemplateCategory` fills a process-local map. A module calling it from its own code fixes the web process and leaves `email:dispatch`, a separate process, with no allow-list for the category. `renderEmailTemplate` then substitutes **no** variable, and the mail goes out with an empty value. In one downstream embedder this was a launch blocker (a one-time code rendered empty). It is not only a downstream problem: in this repository `newsletter` enqueues `derived.newsletter_confirmation`, which nothing registered in any process, so its confirmation link rendered as an empty string.
2. **WhatsApp templates.** The same shape: `registerWhatsappTemplate` is process-local, `booking` registered through a function that `scripts/whatsapp-dispatch.ts`, `scripts/whatsapp-meta-preflight.ts` and `scripts/booking-reminders-dispatch.ts` each had to import by name. A downstream product added its own line to the same script. A forgotten line is a runtime `template_unknown`, not a build error.
3. **The worker category allow-list.** `sql/302` made `awcms_email_messages_worker_guard` refuse a worker insert outside three categories, with the list **inside the function body**. A downstream template needing a fourth category re-issued the function in its own migration, which silently replaces every later upstream change to it (membership test, `search_path`, error code) with a stale copy.

## Decision

### 1. Two new optional descriptor fields (module contract 4.7.0)

`ModuleDescriptor.emailTemplateCategories` (`category`, `allowedVariables`, optional `workerInsert`) and `ModuleDescriptor.whatsappTemplates` (the exact shape `registerWhatsappTemplate` validates). MINOR and purely additive: no existing descriptor changes meaning. `awcms-family-compatibility.yaml` records 4.7.0.

### 2. Resolved on demand by the owner of the registry, in every process

No startup call, no hook, no import for a consumer to forget.

- `email/domain/email-template-categories.ts` resolves `derived.*` allow-lists from the **descriptor source a composition root installed**, at lookup time, after the fixed base list. The lookup is a scan of a few dozen descriptors; there is no cache to invalidate.
- `whatsapp-delivery/domain/whatsapp-templates.ts` registers the templates of every not-yet-seen descriptor on the first `getWhatsappTemplate` / `listWhatsappTemplates` and treats each descriptor once.

The source is a small injection seam (`_shared/extension-point-source.ts`). A **composition root** installs it once: the web entry (`src/middleware.ts`) and the dispatcher scripts that render or send derived categories and templates (`email-dispatch`, `whatsapp-dispatch`, `whatsapp-meta-preflight`, `booking-reminders-dispatch`) call `installExtensionPointSource(listModules)`. The two registries deliberately do **not** import the module list themselves (see the least-privilege consequence). A process that asks for something only a descriptor can answer (a `derived.*` category, a non-built-in template key) with no source installed gets a clear `ExtensionPointSourceNotInstalledError`, **not** "unknown category, no variables" (the silent per-process gap this ADR removes); base categories and `system.notice` need no source. The gate verifies every composition root installs it. `registerDerivedEmailTemplateCategory` and `registerWhatsappTemplate` stay as the registries' own tools and test seams; a gate (section 4) rejects any other caller.

Fail-closed is preserved: an undeclared `derived.*` category is still unknown (`null` allow-list, every variable dropped, template creation refused), and a `derived.*` declaration cannot shadow a base category.

### 3. The worker allow-list is rows of `awcms_email_worker_categories` (`sql/410`)

A global table, one `category` per row, seeded by `sql/410` with exactly the union the LATEST guard body (`sql/371`, not `sql/302`) allowed: the three `hr.attendance_correction_*` and the three `crm.follow_up_*` categories, so behaviour is unchanged. `sql/410` replaces the guard function **once**, to read the table; the guard is otherwise the `sql/371` body (the staff-recipient and variable-key conditions of `crm.follow_up_*` stay; membership of `awcms_worker` checked for `session_user` and `current_user`, superusers exempt, `search_path` pinned ending in `pg_temp`).

- **Fail-closed:** the test is `NOT EXISTS` over the table, so an empty table refuses every worker insert, and an absent row is what denies.
- **Read-only at runtime:** `awcms_app` and `awcms_worker` hold `SELECT` only (the guard runs as the inserting role). A runtime path able to insert here could widen its own repertoire and no RLS policy would object, there being no tenant column; the table is therefore listed in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (no INSERT/UPDATE/DELETE) and keyed `SELECT` in `WORKER_ROLE_GRANTS`, exactly like the entitlement catalogue of `sql/109`.
- **How a module adds a category:** `emailTemplateCategories: [{ ..., workerInsert: true }]` plus `INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.x') ON CONFLICT DO NOTHING` in the module's own migration. The gate cross-checks the flag against the seeded rows in both directions (a flagged category must be seeded; **every** seeded row must be claimed: by a flagged declaration, or by a `workerEmailCategories` claim on the owning module's descriptor, one reason per entry, exact in both directions and one owner per category; the gate also reads the literal list of the last guard body before `sql/410` and fails if the seed is narrower than it), so an allowance nobody owns cannot widen the worker silently. A migration after `sql/410` that re-issues the guard function fails the gate.

### 4. One gate, `bun run extension-points:check` (in `check`)

Pure, no database: runs the shared validator over every descriptor (`derived.` prefix, snake case, no duplicates across modules, no base-category clash, valid and unique variable names, WhatsApp keys prefixed by the owning module, a security template needs a secret variable, a declaring module depends on `email`, or depends on / consumes `whatsapp_delivery`); confirms the WhatsApp registry loads them; rejects any call of the two register functions outside the registries' own files (tests are not scanned); and runs the three worker-allow-list checks above. `tests/descriptor-extension-points.test.ts` proves it goes red when each protection is removed, and runs **fresh bun processes** that import only the dispatcher's own code to show a declared category and template are known there; `tests/integration/email-worker-category-allow-list.integration.test.ts` does the database half as the real `awcms_worker` role.

## Consequences

- Positive: a module's category and templates travel with the module; no upstream-owned file is edited downstream, so subtree syncs have nothing to re-check; a missing registration is no longer a runtime-only failure. The in-repo `newsletter` confirmation mail now renders its link. `booking`'s side-effect import (`infrastructure/booking-whatsapp-templates.ts`) and the three script calls are gone.
- Positive: the guard function has one owner; downstream adds a row, never a function.
- Behaviour change for embedders: an embedder that calls `registerDerivedEmailTemplateCategory` / `registerWhatsappTemplate` from application code now fails `extension-points:check` and moves the declaration to its descriptor; one that re-issued the guard function loses that override and must seed rows instead (with its categories declared `workerInsert`).
- Negative: every process that renders a derived category or uses a derived template must install the source in its composition root; a new process that forgets fails loudly and clearly (not silently), and adding a root means editing `COMPOSITION_ROOTS` in the gate.
- Least privilege is not regressed: because the registries do not import the module list, the static import closure of a job such as `omnichannel-inbox:sla` is unchanged and the runner still withholds its `WORKER_DATABASE_URL` (`appRoleTargetsWithoutWorkerClient`, audit L-5 of PR #1301; verified by `tests/descriptor-extension-points.test.ts`). This ADR's first design, registries importing `listModules`, lost it; the composition-root alternative is what is implemented.
- Negative: a malformed WhatsApp declaration throws at the first lookup in a process rather than at startup; the gate is the primary guard and the throw is the backstop.
- Out of scope: the e-mail template **locale/key coupling**, `DOMAIN_EVENT_TYPE_REGISTRY` (ADR-0134's follow-up) and any change to who may enqueue from a worker beyond the data-driven list.

## Alternatives rejected

### A. A `registerX()` call from a bootstrap hook

Rejected for the reason ADR-0134 gave for its alternative A: the set depends on every entry point remembering to run the hook, and the failure mode (a process with a different set) is exactly the defect being removed.

### B. A build-time generated registry file

Rejected as ADR-0134's alternative B: a second artefact to regenerate, and a downstream template would regenerate a file at an upstream path, which is the edit being eliminated.

### C. Keep the function and ask embedders to re-issue it with a documented procedure

Rejected: this is the status quo. The override is silent and permanent; documentation does not make a stale function body fresh.

### D. A database session setting (GUC) for the allowed categories

Rejected: a worker session could set it itself, so the guard would protect nothing against a compromised worker, which is its entire purpose.

### E. `SECURITY DEFINER` guard reading a table the worker cannot read

Rejected: inside a definer function `current_user` is the owner, and the superuser exemption (`rolsuper` of `current_user`) would exempt every caller when the owner is a superuser. Granting the worker `SELECT` on a read-only list is simpler and leaks only category names.
