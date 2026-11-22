🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](public-form-challenge.id.md)

# Public-form challenge (captcha) seam

Implementation reference for Issue #1353 (owner decision K9, 22 November 2026). Module contract `4.8.0`. **No migration.** Cloudflare Turnstile ([ADR-0029](../adr/0029-deployment-profile-aware-turnstile-bot-protection.md), `turnstile-bot-protection.md`) is the first provider behind it, and its former per-route call sites now go through this seam, so there is **one** path.

## 1. What it is

A pre-session form (login, forgot/reset password, register, invitation accept, platform setup, or a module's own public form) opts into a human-presence challenge with one call:

```ts
const refused = await enforcePublicFormCaptcha(request, "my_form", body, {
  clientIp
});
if (refused) return refused;
```

No edit to a shared file. `src/lib/security/public-form-challenge.ts` owns the seam; a module contributes a provider from its own descriptor (`ModuleDescriptor.publicFormChallengeProviders`, ADR-0164's model: the seam reads the module list through the extension-point source that `src/middleware.ts` installs). The platform ships exactly one provider, Turnstile, declared by `identity-access`. It ships no widget and no puzzle of its own.

**The rate limit of each route stays the primary control.** It runs before the seam and is not relaxed by it.

## 2. Contract, in the order it is enforced

| Property                 | Behaviour                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off by default           | No declared provider switched on by its own `isEnabled(env)` means the call returns `null`; a deployment that sets nothing behaves exactly as before. Turnstile is on only with the full-online profile gate and `TURNSTILE_ENABLED=true`.                                                                                             |
| One provider             | More than one enabled provider is a configuration error and the request is **refused**. A provider whose `isEnabled` throws is refused too, never assumed off.                                                                                                                                                                         |
| Fail-closed              | A missing token, a refusing verifier, a verifier that **throws**, one that does not answer in 10 s, and a result that is not exactly `{ ok: true }` all refuse the request. The verifier's error text is never logged or returned.                                                                                                     |
| Single use               | A presented token is burned (hashed, bounded to 10 000 entries, 15 minutes, per process) **before** the verifier is asked, so a replay is refused even when requests race, and a refused attempt cannot be retried with the same token. The provider's own `verify` is the source of truth across processes; this is defence in depth. |
| Bound to form and tenant | `verify` receives the form name and the tenant (`x-awcms-tenant-id`, or the `tenantId` option, or `null` for a tenant-less form) and must refuse a token issued for another. Turnstile binds the form (its `action`) and the hostname; it has no tenant concept, so its tenant binding is the deployment's host.                       |
| No oracle                | Everything except "nothing presented" is one response: wrong form, wrong tenant, replay, expired, verifier error and timeout are indistinguishable. "Nothing presented" is `CHALLENGE_REQUIRED` so a client knows to render its widget.                                                                                                |
| Bounded input            | A field over 4 096 characters is refused without reaching the verifier; a non-string field counts as absent.                                                                                                                                                                                                                           |

## 3. Provider contract

`ModulePublicFormChallengeProvider` (`src/modules/_shared/public-form-challenge-contract.ts`): `key`, `isEnabled(env)`, `issue(formName, tenantId) -> challenge`, `verify({ token, challengeId, challengeAnswer, formName, tenantId, remoteIp, env }) -> { ok: true } | { ok: false, reason }`, and optionally `legacyTokenField`, `refusal` (code and message of an already published contract; Turnstile keeps `TURNSTILE_REQUIRED` / `TURNSTILE_INVALID` and the `turnstileToken` field) and `solveForTests`. A self-hosted arithmetic challenge and a third-party provider are both valid implementations; `issuePublicFormChallenge(formName, tenantId)` is the server entry point for an endpoint that hands a client its challenge (the platform ships no such endpoint, because no provider of its own needs one).

A provider whose verifier reads a **web-only secret** (Turnstile's `TURNSTILE_SECRET_KEY`) must keep its descriptor LIGHT: `listModules()` is imported by dozens of jobs, so importing the file that reads the secret would put it in their import closure (`tests/jobs-env-scoped-reach.test.ts`, part c, fails, and the secret would have to be copied into every job container). Its `verify`/`issue` therefore resolve the implementation from a verifier slot (`_shared/public-form-challenge-verifier-slot.ts`) that `src/lib/security/public-form-challenge-bindings.ts` fills; the seam imports that file, so every process that enforces a challenge has it bound, and no job does. Nothing bound means `verify` throws, which the seam refuses. A provider with no web-only secret just implements `verify` in its descriptor.

`bun run extension-points:check` validates the declarations (unique snake_case keys, the three functions present, well-formed refusal codes) and refuses any direct call of `enforceTurnstileIfRequired` outside `turnstile.ts` and the Turnstile provider: a direct call is a second path that skips the burn, the deadline and the uniform refusal.

## 4. Client

Field contract: `challengeId`, `challengeAnswer`, `challengeToken`. `src/lib/ui/public-form-challenge-client.ts` reads them from the submitted form (`readChallengeFields`, which also reads Turnstile's `cf-turnstile-response` as `challengeToken`) so a page spreads them into its JSON body, and `focusChallengeOnRefusal` hands focus back to the element marked `data-challenge-widget` when the response code is a challenge refusal. With no widget on the page the helper returns `{}`, so the body is exactly what it was. A page script must **import** the helper: Astro inlines a script without an import and this app's CSP blocks inline scripts.

Rendering a widget is provider-specific and stays with the page that enables the provider. The forgot and reset password pages use the helper; `/reset-password` now also renders the Turnstile widget (before, the reset API required a token the page could not produce when Turnstile was on).

## 5. Integration harness

`invoke()` in `tests/integration/harness.ts` adds a **solved** challenge to the JSON body of a platform pre-session form when a provider is on and offers `solveForTests`, so a suite needs no per-route edit. `challenge: false` opts out (to test a refusal); fields already in the body are never overwritten. With no provider on, which is the default, nothing changes.

## 6. Open points

- The single-use burn is per process. A provider without its own single-use guarantee is replayable across processes; the contract requires the guarantee at the provider.
- Other modules' public forms (newsletter, comments, website-engagement sources) keep their own protections; each can opt into the seam with the one call.
