🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](provider-outcome-contract.id.md)

# Third-party outcome taxonomy and default-deny routing policy

Issue #1410. Code: [`src/lib/integration/provider-outcome.ts`](../../src/lib/integration/provider-outcome.ts). Tests: `tests/provider-outcome-contract.test.ts`. Contract version: `PROVIDER_OUTCOME_CONTRACT_VERSION = "1.0.0"`.

## What it is, and is not

A **pure, versioned, provider-neutral decision library**. It does no I/O, reads no environment, holds no credential and never calls a provider.

It is **not** a dispatcher, gateway, queue or client. Each domain keeps its own port, outbox and ledger ([ADR-0006](../adr/0006-offline-first-sync-outbox.md): providers are called outside DB transactions, through an outbox). The shared part is only the vocabulary and the rule for "what may I do next?", so that email, WhatsApp, push, payment and object-sync adapters stop re-inventing it differently. This is consistent with the integration-hub reconciliation direction (a shared pure library, not a hub; domain-owned ports/outboxes).

**No live adapter calls it today.** Adoption (for example the email port's `skipped` / `uncertain` / `retryAfterMs`, see `src/modules/email/domain/email-provider-contract.ts`) is a separate, opt-in change per domain. There is no production flag and nothing to switch on.

## Outcomes

| Outcome            | Meaning                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `succeeded`        | The provider says the work is done (delivered, settled).                                      |
| `accepted`         | The provider took the request; completion unknown. **Acceptance is not delivery/settlement.** |
| `not_sent`         | Provably nothing reached the provider, or it rejected before processing (HTTP 429).           |
| `confirmed_failed` | The provider authoritatively said it did not perform it. Carries `failureScope`.              |
| `unknown`          | The request may or may not have been processed.                                               |

`classifyProviderCall(evidence)` maps raw evidence to one outcome, default-deny:

- circuit open, local validation, connection refused, DNS failure: `not_sent`.
- timeout / reset / unreadable body after a send was possible: `unknown`.
- HTTP 2xx: judged by the **body** verdict. `failure` is `confirmed_failed` (a 200 with `success:false` is a failure); `success` is `accepted`, or `succeeded` only when marked `final`; no recognisable verdict is `unknown`, never success.
- 429: `not_sent` with `Retry-After` (seconds or HTTP-date) clamped to `MAX_RETRY_AFTER_MS` (5 min); unparseable or negative is ignored.
- 401/402/403: `confirmed_failed`, scope `provider` (credentials/credit, a different provider may work). Other 4xx: `confirmed_failed`, scope `request`. 408, 409, 3xx, 5xx: `unknown`.

## Decisions

`decideRouting(input)` returns one of `hold | retry_same | switch_provider | reconcile | manual_review`, plus `complete` for terminal success, with a machine-readable `reason` and the contract version.

Inputs: operation kind (`read_only | write | financial | notification`), outcome, whether a certified-equivalent provider is available, consent (`granted | not_required | missing`), idempotency support, correlation id, budgets (same-provider attempts, switches), whether reconciliation is available, and a policy.

Rules, in force order:

1. Malformed input: `manual_review` (default-deny).
2. `succeeded`: `complete`.
3. Non-read operation without a correlation id: `manual_review` if the call may have reached the provider, else `hold`.
4. `accepted`: `reconcile` (or `manual_review` without reconciliation). Never repeated, never switched.
5. `unknown`: **financial** is `reconcile`/`manual_review`, never `retry_same` or `switch_provider`. Read-only is retried while budget remains. Write/notification is retried on the same provider only if the provider supports idempotency and consent is present; otherwise `reconcile` or `manual_review`. **Never `switch_provider`.**
6. `confirmed_failed` with request scope: `manual_review` (a bad request fails the same everywhere).
7. `not_sent`: `hold` without consent; `retry_same` while budget remains (honouring `retryAfterMs`); then failover or `manual_review`.
8. Failover (`not_sent` after budget, or provider-scope `confirmed_failed`) requires **all** of: `policy.failoverEnabled` (default **off**), a certified-equivalent provider, consent, switch budget, idempotency support for non-read operations, and for financial operations also `policy.financialFailoverAuthorized`. The domain sets that from an authorised decision, never from client input.

The properties are enforced by tests over the full cross-product: `accepted`/`unknown` never produce `switch_provider`; financial `accepted`/`unknown` only produce `reconcile` or `manual_review`; `switch_provider` implies every precondition above; the default policy never switches; decisions are deterministic.

## Threat and privacy notes

- **No client-supplied provider host or credential.** The contract accepts neither; it takes classifications and booleans only. Provider selection, endpoints and secrets stay in domain configuration. SSRF is therefore out of this module's surface; adapters that fetch remote URLs keep their own guards (ADR-0106).
- **Secrets.** Evidence carries a status code, a verdict and a header value, never a request/response body or credential. Callers must not put provider error text into `reason`; reasons are a closed enum.
- **Tenant spoofing.** The library has no tenant concept and no data access. The correlation id and tenant context come from the domain, which keeps ABAC default-deny and RLS at its own boundary; a correlation id must not be taken from an unauthenticated request.
- **Webhook replay.** Reconciliation inputs that arrive as webhooks still need the signature and anti-replay checks of the receiving domain (see `awcms-sync-hmac`); this contract only says that `accepted`/`unknown` must be settled by such evidence or a human, not by another provider.
- **Retry-After abuse.** A hostile or buggy provider cannot park work for longer than 5 minutes through the header.

## Changing the contract

Any change to classification or decision semantics bumps `PROVIDER_OUTCOME_CONTRACT_VERSION` and the test matrix. No OpenAPI or AsyncAPI change applies: no endpoint or event is added.
