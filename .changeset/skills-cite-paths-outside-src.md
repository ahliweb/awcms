---
"awcms": patch
---

fix(docs): the gate that holds skills to the code only ever read `src/`, and the go-live skill contradicted its own banner

`skills:check` was built on the premise that a wrong skill is worse than a stale
doc, because an agent **follows** a skill. Its rule 1 reads `src/…` citations
and nothing else. Every other directory a skill talks about — `tests/`,
`scripts/`, `openapi/`, `deploy/`, `ops/`, `docs/` — was ungoverned, and that is
where a skill does its most operational talking: which test proves a claim,
which script to run, which runbook to follow before a production migration.

A sweep of the corpus found ~60 such citations that resolve to nothing. They did
not fail cosmetically.

## `awcms-production-preflight` told an operator to break the backup

Its banner says, correctly, that `bun run production:preflight` **does not
exist**. Forty lines below, a section described `scripts/production-preflight.ts`
in detail — ten stages, `REMAINING_CHILD_PROCESS_STAGES`, three mandatory apply
flags, an `authorizeApply` "covered by unit tests", a `--json-output` evidence
artefact. None of it exists; the file has never been in this repo. This is the
`awcms-performance` failure mode the gate's own comments record, in the corpus
the gate was written to protect.

Worse, §Backup & restore instructed the operator to set
`BACKUP_ENCRYPTION_KEY_FILE`/`BACKUP_HMAC_KEY_FILE` before taking the go-live
backup. `deploy/backup/backup-postgres.sh` **refuses to run** when either is set
— its own `die()` message says at-rest encryption and manifest signing are not
implemented and names `production-preflight-runbook.md` §Stage 2 as overstating
them. Following the skill literally broke the last step before a production
migration. The runbook said the same thing and is corrected too; its status
banner had additionally aged in the wrong direction, claiming `deploy/` held
only a pgbouncer example long after the two backup scripts landed.

The target design is kept, fenced as `aspirational`, because the flag semantics
are the reason restore-tested backup evidence matters at all. What replaces it
is what you can actually run.

## `awcms-profile-identity` denied a whole test tier

It stated twice that this repo "has no `tests/integration/` at all yet (Issue
#154)". Issue #154 landed: there is a harness and ~74 specs. An agent following
that skill skips the tier entirely. What is actually missing is the one
profile-identity spec, which is now what it says.

## The rest

- `awcms-github-snapshot` was a live-sounding skill for `docs/awcms/github/` — a
  tree never committed here — driven by a script that does not exist. Reframed
  as a target spec (its `gh` commands, which are real, moved outside the fence),
  and the rows in `docs/awcms/README.md`, doc 09, `repo-inventory.md` and the
  skills index that presented it as a live task now say so.
- `awcms-module-management` credited `bun run modules:sync`
  (`scripts/modules-sync.ts`) with refusing a broken graph. `scripts/README.md`
  §Deferred already records that this target never existed and that the real
  mechanism is `POST /api/v1/modules/sync` — six code comments were corrected
  for this once already; the skill kept the claim.
- `awcms-repo-inventory` named `scripts/repo-inventory-generate.ts` and
  `RLS_EXEMPT_TABLES`; the generator is `scripts/repo-inventory.ts` and the
  allow-list is `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` in
  `scripts/security-readiness.ts`, which also pins the forbidden privileges.
- `blog_content`'s README cited three test files that have never existed, for
  its single-source-of-truth rule, its secret-shaped-key rejection and its admin
  RLS isolation. Two of those assertions exist nowhere, so the README now says
  the claims are unproven rather than naming a file to trust.
- A dozen `tests/unit/<x>.test.ts` citations carried over from mini's layout;
  this repo puts tests flat under `tests/`.

## Rule 6

Same shape as rule 1, over the other governed directories, across both language
copies of every skill and every module README. Three deliberate carve-outs:

- **`sql/` is not governed.** `sql/005` is a migration NUMBER, not a path (the
  file is `005_awcms_….sql`). The first draft checked it as a filename and went
  red on every correct citation in the corpus. `check:docs` already validates
  those by number, which is the form they are written in.
- **An absence claim is exempt.** "there is no `deploy/backup/README.md`" has to
  stay sayable, or the gate deletes the sentences that correct the record.
  Detected by phrase, in both languages, near the citation — and required at
  **every** occurrence, so one honest paragraph cannot license a second
  live-sounding one. That is the preflight defect, stated as a property.
- **Sibling-repo citations are scoped, not banned.** `awcms-mini:tests/…` names
  a file this repo cannot check. The prefix was already the convention; rule 6
  makes it load-bearing, so an unprefixed path is a claim about THIS repo.

Line/anchor suffixes are trimmed (`ops/run-job.sh:88,92`), and paths broken
across lines by prettier are rejoined first — rule 1 shipped with that hole, and
the citation it hid had never existed.

Mutation-proven against the real sentences, not invented ones: each of the four
defects above goes red, and the absence claims, sibling-repo citations, globs
and resolving paths stay green.
