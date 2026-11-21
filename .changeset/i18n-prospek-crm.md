---
"awcms": patch
---

fix(i18n): the Indonesian catalog (`locales/id.po`) translates the CRM term "lead" as "Prospek" everywhere it was used as a domain term (for example "Pipeline prospek", "Pindahkan prospek", "{count} prospek"), replacing "Lead" and "Pipeline lead". Message IDs are unchanged, so English and API behaviour are unaffected. The regenerated `id.generated.ts` catalog carries the new strings. Tracks ISSUE #1351.
