🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](whatsapp-meta-enable-runbook.id.md)

# WhatsApp Meta senders — enablement runbook (Issue #1298)

Audience: the operator who switches the tenant-owned Meta Cloud API path on for a deployment that **already holds Meta numbers**, and the person who reviews that change. Background: [`whatsapp_delivery` README](../../src/modules/whatsapp-delivery/README.md#meta-cloud-api-multi-waba-senders-issue-1143) (Issue #1143) and finding L5 of the independent audit of #1267.

## 0. Why this exists

Since #1143 a tenant-owned Meta number sends only as part of a **live WABA container**, and a template message needs a **sendable approval of the right category on that WABA**. Rows that were queued before, and numbers registered before, do not have either. They do not fail at enable time: they fail **terminally at their next dispatch**, and that includes an OTP (`security`) row that is already queued, which cannot be re-sent in time. Nothing reroutes them and nothing falls back to free text. So the check has to happen **before** the path is switched on.

## 1. The preflight (read-only)

```sh
bun run whatsapp:meta:preflight
```

It reads three things per tenant as `awcms_worker` (the dispatcher's own role): the connected Meta numbers and their WABA parent, what is queued on them (`queued`, `retry_wait`, `sending`), and the template approvals. It applies the dispatcher's own rule (`decideMetaSend`) and prints, per tenant code, only account ids, template keys and counts — never a number, a recipient, a hash, a body or a token. It writes nothing and calls no provider.

Exit `0` = nothing queued on a Meta number would fail terminally. Exit `1` = at least one line below, or a tenant that could not be read.

| Line                                        | Meaning                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `number ... has NO live WABA parent`        | The number was registered without a `waba` container (or its container was deleted). Every row on it, OTP included, fails with an invalid binding.                                                                                                              | Register the WABA (`account_kind: waba`, `external_id` = the WABA id) and re-parent the number under it.                                                                                              |
| `number ... cannot send (REASON, terminal)` | The dispatcher's own verdict for the number is terminal: the WABA parent is `revoked`/`disabled`, its business scope does not contain the number's (`CONTAINER_BINDING_INVALID`), the number lacks the `dm` capability, and so on. Queued rows fail terminally. | Repair the parent (status, scope) or the number.                                                                                                                                                      |
| `number ... cannot send (REASON, hold)`     | Not usable now but recoverable (a degraded or pending parent, an expired grant, the channel-accounts control plane off in this environment). Rows wait; an OTP still expires.                                                                                   | Wait for or fix the cause, then re-run.                                                                                                                                                               |
| `... will fail (TEMPLATE_NOT_APPROVED)`     | No sendable approval of the right category for that template on that number's WABA. The line names the template and language Meta must show.                                                                                                                    | In WhatsApp Manager confirm the template is `APPROVED`, then record it: `PUT /api/v1/whatsapp/meta-templates` with an `evidenceRef`. A signed status webhook keeps it current afterwards (section 3). |
| `... will fail (OUTSIDE_SERVICE_WINDOW)`    | A free-text row whose recipient has not written to this number in the last 24 hours.                                                                                                                                                                            | Nothing to record: either Meta's window opens (the person writes first) or the row is cancelled. Marketing is never free text.                                                                        |
| `... will fail (TEMPLATE_UNREGISTERED)`     | The template key is not registered in this process (a consumer module's templates are registered by the job entrypoint).                                                                                                                                        | Deploy the consumer's code, or cancel the rows.                                                                                                                                                       |
| `the approval list was truncated`           | A tenant with more than 5000 approval rows: a "not approved" line may be a row that was not read.                                                                                                                                                               | Check that tenant by hand.                                                                                                                                                                            |

An approval backfill is **deliberately not automated**. An approval is Meta's fact and needs evidence (`evidenceRef`); a script that wrote `APPROVED` rows would authorise sends Meta then refuses, and would fake the audit trail of who attested what.

## 2. Order of enablement

1. Deploy a build containing `sql/392` and `sql/393` and run `bun run db:migrate`. (`sql/392` narrows the dispatcher's write access to the queue; `sql/393` puts the webhook ledgers on the database clock.)
2. Run `bun run whatsapp:meta:preflight` against production data. Resolve every line, or deliberately drain the rows it names (cancel them) — do not enable with a known `security` row that would fail.
3. Run `bun run security:readiness` with the production environment. It pins the new column grant, the worker guard trigger, the two clock triggers and the narrowed app privileges; a finding there means the migration did not take effect.
4. For each Meta number create its webhook subscription (`POST /api/v1/channel-accounts/accounts/{id}/webhook-subscription`) and configure the callback URL at Meta (section 3).
5. Set `WHATSAPP_ENABLED=true` for the web process and the `whatsapp:dispatch` job. Run the preflight once more (it is cheap) and watch the first pass.

## 3. After enabling

- **Webhooks.** `https://<host>/api/v1/whatsapp/webhooks/meta/<token>` per number, the same token as the verify token. Configure your reverse proxy not to log `/api/v1/whatsapp/webhooks/`. Meta retries a non-200 for up to seven days; a body already applied is answered `200` and changes nothing.
- **A delivery older than seven days** (by its `entry.time`) changes no template, limit or restriction state: it cannot be told apart from a replay of a captured body once its receipt is gone. A later event repairs the state.
- **A restriction an operator cleared** stays cleared against any event Meta stamped before the clear; only a later event restricts again.
- **429 on the webhook.** The per-address bucket counts unverified requests only; the per-(tenant, address) bucket (1200 a minute) is refunded for a verified new delivery, so a busy tenant is not throttled by its own traffic. A tenant that sees `429` is sending refusals or duplicates: check its app secret and Meta's retry behaviour.

## 4. Rolling back

Unset `WHATSAPP_ENABLED` (web and job) and restart. Rows already `sent` stay `sent`; queued rows stay queued and are sent or failed by the same rules when the flag returns. `sql/392` and `sql/393` are forward-only and need no rollback: they only narrow privileges and stamp clocks.
