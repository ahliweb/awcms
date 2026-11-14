---
"awcms": patch
---

fix(blog_content): the scheduled publish sweep works under the least-privilege `awcms_worker` role again. Recording a revision per published post (the earlier fix) needs `INSERT` and `SELECT` on `awcms_blog_revisions`, which `awcms_worker` did not hold, so under a worker-role deployment the first due post made the tenant transaction roll back with `permission denied`, the post stayed `scheduled`, and the run stopped for every later tenant, including the withdrawal of expired posts. New migration `sql/397` grants exactly `SELECT, INSERT` (append-only: no UPDATE/DELETE); `security:readiness` lists the grant; the job now isolates a failure per tenant and per half (publish, withdraw) and reports `failedTenants` with status `partial`. No API or event change.
