---
"awcms": minor
---

feat(email, whatsapp_delivery): derived e-mail categories and WhatsApp templates are declared in the module descriptor and loaded in every process that installs the descriptor source at its composition root (web entry and dispatcher scripts), with no side-effect import; the worker category allow-list is data (Issue #1277, ADR-0164, Proposed).

**Descriptor contract 4.7.0 (additive).** `ModuleDescriptor.emailTemplateCategories` and `whatsappTemplates`. `email` resolves `derived.*` allow-lists, and the WhatsApp template registry loads templates, from the descriptors a composition root installed (`installExtensionPointSource(listModules)`), so `email:dispatch` and `whatsapp:dispatch` know them without importing the owning module. `booking` now declares its two templates (its side-effect import and the three script calls are removed); `newsletter` declares `derived.newsletter_confirmation`, which no process registered before, so its confirmation link rendered as an empty string.

**Worker allow-list is rows (`sql/410`).** `awcms_email_worker_categories` (global, `SELECT` only for `awcms_app` and `awcms_worker`) seeded with the exact union the latest guard body (`sql/371`) allowed (three `hr.attendance_correction_*`, three `crm.follow_up_*`); the guard function is replaced once to read it, keeping every other condition of the `sql/371` body (staff recipient and variable keys for `crm.follow_up_*`), fail-closed on an empty table. A module adds its category with an `INSERT` in its own migration and a `workerInsert: true` declaration, never by re-issuing the function.

**Behaviour change for embedders.** Calling `registerDerivedEmailTemplateCategory` / `registerWhatsappTemplate` from application code, or re-issuing `awcms_email_guard_worker_insert` in a migration after sql/410, now fails the new `bun run extension-points:check` (in `check`). Move the registration into the descriptor and seed a row instead.


**Least privilege kept.** The registries do not import the module list (a process without an installed source fails with `ExtensionPointSourceNotInstalledError`, never as an empty variable list), so job import closures do not grow and `omnichannel-inbox:sla` keeps its `WORKER_DATABASE_URL` withholding. The gate's worker-category ownership rule is exact (a base row is claimed by `workerEmailCategories` on the owning descriptor, with a reason) and its SQL reader follows the Postgres lexer (digit-tagged and nested dollar quotes, E strings, nested comments, quoted identifiers) and fails closed; it also fails when the seed is narrower than the last pre-410 guard body.
