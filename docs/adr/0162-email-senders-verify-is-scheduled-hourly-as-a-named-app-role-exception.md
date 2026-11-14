🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0162-email-senders-verify-is-scheduled-hourly-as-a-named-app-role-exception.id.md)

# ADR-0162 — `email:senders:verify` is scheduled hourly as a named `awcms_app` exception, and app-role scheduled jobs are a recorded, two-way-tested list

- **Status:** Accepted (the schedule and the exception mechanism); the choice of `awcms_app` as the job's role is provisional pending owner confirmation (O1)
- **Date:** 2026-11-14
- **Decision maker:** ahliweb (owner). The decision itself was taken on 11 November 2026 when ADR-0159 was accepted: "`email:senders:verify` is to be scheduled (follow-up PR)" ([`docs/PROJECT_STATE.md`](../PROJECT_STATE.md) §4). The owner decided THAT it is scheduled; the choice of the `awcms_app` login to run it as was made in the implementing PR, not by the owner, and is **provisional** until the owner confirms it (see O1 and the audit addendum). This ADR therefore does not claim to add no authority: it puts the app login and the secret key ring in one scheduled container for the first time.
- **Resolves:** the schedule half of Issue #1160 (the job and the sender routing exist; the job was `manual`).
- **Extends:** [ADR-0147](0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.md) (the first, then single, scheduled `awcms_app` job), [ADR-0151](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.md) §2 and §6 (tenant Mailketing accounts and verified senders), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) §5 (channel secrets, the key ring).
- **Related:** Issue #1132 (the app connection is withheld from every crontab job), [ADR-0160](0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.md) (the second scheduled `awcms_app` job).

**No migration, table, route or event.** The change is a schedule, one exception entry, and a test that makes every such exception a named, reasoned, two-way-tested entry.

## Context

`email:senders:verify` reads each tenant Mailketing account's credit balance and verified senders (`GET /credits`, `GET /senders`, read-only) and records them as account health. A tenant sender becomes usable only when the provider reported it verified, and `email:dispatch` holds a sender whose health is older than `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` (default 360) or unknown. Run by hand, every tenant sender goes stale after six hours and is held (fail closed), so the feature cannot operate unattended.

Two rules made it `manual`:

1. It **writes** channel-account health and status, which only `awcms_app` may (a worker that could would be able to mark an unverified sender verified).
2. Issue #1132 withholds `DATABASE_URL` (the `awcms_app` login) from every crontab job, so an app-role job needs a recorded exception. Until now two existed (ADR-0147, ADR-0160), but only as a hand-written set inside two tests, with no reason or ADR attached.

## Decision

1. **Schedule `email:senders:verify` hourly** (`0 * * * *`, `backlog: "bounded"`). Hourly is six times more often than the 360-minute freshness window, so one or two failed passes do not strand a sender. The job stays a no-op (exit 0) unless `EMAIL_SENDER_ROUTING_ENABLED` is `"true"`, so installing the crontab changes nothing on a deployment that has not turned the feature on.
2. **It is admitted as the third scheduled `awcms_app` job**, on these bounds, none of which this ADR widens:
   - the provider calls are **read-only `GET`s**; the job sends nothing and spends nothing;
   - health and status are written only through `channel_accounts`' own `recordAccountHealth`, in the tenant's transaction, under RLS;
   - one failing tenant does not stop the others (the pass counts it and exits non-zero at the end);
   - the token is decrypted in memory, once per account per pass, and never printed;
   - it holds `CHANNEL_SECRETS_ENCRYPTION_KEYS` through the existing per-job scoped grant, exactly as before.
3. **The exceptions become data.** `APP_ROLE_SCHEDULED_EXCEPTIONS` in `scripts/jobs-env-allowlist.ts` lists each scheduled job that keeps `DATABASE_URL`, with its Accepted ADR, its single app-client entrypoint, and its reason. `tests/jobs-app-role-exceptions.test.ts` enforces it in both directions: a crontab job that keeps the credential and is not listed fails; a listed entry that is not scheduled, no longer keeps the credential, has no ADR or reason, or whose entrypoint is not the only file in its reach opening the app connection fails. The two older entries are moved into it unchanged. The runner's own derivation (`appConnectionTargets`, from the import closure) is untouched: the list does not grant anything, it only names what the derivation already allows.

## Why this is safe, and what it does not claim

- The job container for this job now holds, together, the app login and the channel-secrets key ring. The web process runs with the deployment's full environment, the same login and (where channel accounts are used) the same key ring, so the job adds no new class of capability that this ADR can name; it adds a second place where the pair co-resides, for the minute the job runs each hour, with no inbound surface.
- The worker-role alternative is closed by rule 1 above. A **dedicated database role** (`awcms_email_senders_verify`, in the pattern of `awcms_social_dispatch`) holding only `UPDATE` of the health columns and a RESTRICTIVE read of Mailketing accounts would be the narrower design. It is **not** built here because it needs a migration, a role, column-level grants and abuse tests for a read-only job; it is recorded as the open decision below and is the right next step if the owner wants the job off the app login.

## Open decision

**O1 (needs the owner).** Confirm `awcms_app` as this job's role, or move `email:senders:verify` to a dedicated database role `awcms_email_senders_verify` (pattern `awcms_social_dispatch`): a RESTRICTIVE `SELECT` on the `api_token` secret of Mailketing `esp_account` accounts only, `UPDATE` of the health and status columns only (values bounded by CHECK), and the runner withholding every shared login. That is a migration, a role, readiness pins and abuse tests, so it is its own issue. Until the owner decides, the exception stands, and these controls apply:

- the runner withholds `WORKER_DATABASE_URL` from this job (derived from its import closure, `appRoleTargetsWithoutWorkerClient`), so the container holds the app login and the key ring and no third credential;
- the job exits non-zero when it cannot do its work at all (a failed tenant, an unavailable secret store, accounts present but none probed), so cron monitoring sees a missing or wrong ring instead of a silent hourly success;
- the exception list is gated on an ADR that really says `Status: Accepted`, and the app-connection detector also catches an aliased import of the app client.

Known residue: a compromised dependency in the job's closure, or code execution in its container, can read every tenant's channel secrets through `awcms_app` while it runs. The web process holds the same pair continuously, but the job adds a second, scheduled exposure.

## Consequences

- Positive: tenant senders stay verified without an operator; an added app-role job without an ADR, or a stale exception, turns the suite red.
- Negative: a third job runs with the broadest application login on a timer; a compromised job image would hold it for the length of the run (mitigated by the read-only provider calls, the per-job secret scope and the existing per-release runner/image consistency check).
- Operational: the host reinstalls the generated `ops/awcms-jobs.crontab` and `ops/run-job.sh` companions as for any release; the runner already hands this target `DATABASE_URL`.

## Alternatives rejected

- **Leave it manual.** Fails closed on every tenant sender after six hours; rejected by the owner decision.
- **Run it on the worker role.** The worker cannot write channel-account health, by design.
- **Widen the worker's grants to write health.** Defeats the reason health is app-only.
