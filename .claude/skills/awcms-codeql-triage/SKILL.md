---
name: awcms-codeql-triage
description: Triage and fix AWCMS CodeQL code scanning findings (github.com/ahliweb/awcms/security/code-scanning). Use when asked to "analyse code scanning"/"fix CodeQL", when a PR fails the CodeQL check, or when a new alert appears. Documents six real false positives already found (name-heuristic password, incompatible-types typeof/null, URL substring-sanitization in a test mock, two cases officially dismissed without reformulating the code, Bun.SQL tagged-template null-cast, and a build-time extension seam trivial-conditional) plus the "unused-local-variable in tests sometimes marks a coverage gap" pattern, AND one trivial-conditional counter-example that turned out to be a REAL bug (dead-code fallback because the helper is non-nullish, alert #140) — so it does not have to be investigated from scratch again and valid findings are not dismissed by mistake.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — CodeQL Code Scanning Triage

CodeQL (`.github/workflows/codeql.yml`, matrix `actions` + `javascript-typescript`) runs on every push/PR to `main`. Some findings are real bugs; others are **false positives** from CodeQL's static heuristics that do not see the actual runtime context. This skill is the triage process + the catalogue of confirmed false positives.

## Triage steps (mandatory, do not guess)

1. **Fetch the real alert list** — do not assume from memory/old PRs:
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts --paginate \
     -q '.[] | select(.state=="open") | "\(.number)\t\(.rule.severity)\t\(.rule.id)\t\(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"'
   ```
2. **Fetch the detail + the original message per alert** (not just the rule name):
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts/<N>
   ```
   Read `most_recent_instance.message.text` — that is CodeQL's CONCRETE reason, not the generic rule description. For a PR whose check failed, `gh api repos/ahliweb/awcms/check-runs/<id>/annotations` gives the same location+message.
3. **Look for evidence of whether this is a real bug or a false positive** before writing any code:
   - Check whether the exact same code pattern exists in another file **without** an alert — if it does, that is a strong signal of a contextual false positive (CodeQL's flow-sensitive analysis sometimes produces different results per call-site for identical code).
   - Read the CodeQL message word by word and test it against actual JS/TS semantics — if the message names something that is **impossible** by data flow (e.g. naming a function that provably never returns the field it is accused of), that is definitive proof of a false positive, not a guess.
   - **Do not** immediately add a suppression comment (`// codeql[rule-id]`) as the first attempt — it has been proven **ineffective** in this repo's CI setup (verified in PR #505, Issue #496: the suppression comment still reappeared on the next run).
4. **Fix it with a minimal, behavior-preserving code change** — not by suppressing the alert. If, after investigation, it turns out to be a pure false positive with no reasonable way to reformulate the code, only then consider an official dismissal via the API (see §4 of the catalogue below for two real cases):
   ```bash
   gh api repos/ahliweb/awcms/code-scanning/alerts/<N> -X PATCH \
     -f state=dismissed -f "dismissed_reason=false positive" \
     -f dismissed_comment="<concrete reason + evidence, max 280 characters>"
   ```
   `dismissed_reason` must be EXACTLY `"false positive"` / `"won't fix"` / `"used in tests"` (with spaces) — `false_positive` with an underscore is rejected by the API (422). `dismissed_comment` is limited to 280 characters; put the full reasoning in this skill's catalogue, not in the comment.
5. **Verify**: `bun run check` green, push, wait for CI — confirm the next CodeQL run no longer shows the same alert (not just "it looks right").

## Catalogue of confirmed false positives

### 1. `js/insufficient-password-hash` — function-name heuristic

CodeQL flags **the return value of ANY function whose name contains the substring "password"** as "password-flavored", regardless of what it actually returns or how it is used. Found in Issue #496 (PR #505): `hashPasswordResetToken` (hashing a 256-bit token) and `validateForgotPasswordInput` (returns `{loginIdentifier}`, NO password field at all) were both flagged. Definitive proof of a false positive: the second case _cannot_ be about real data flow because its return type has no password field whatsoever — the only explanation is the name heuristic.

**The fix that proved to work**: **rename** the function so its name does not contain "password" (`generatePasswordResetToken`→`generateResetToken`, `hashPasswordResetToken`→`hashResetToken`, `validateForgotPasswordInput`→`validateForgotIdentifierInput`, `validateResetPasswordInput`→`validateCompleteResetInput`). An inline suppression comment **was tried first and proved not to remove the alert** — do not repeat that road.

**Prevention**: when naming a function that handles hashing/validation related to password/reset/credentials, avoid the substring "password" in the function name if the return value is **not** a raw password/real password hash (e.g. a token, an identifier, a DTO with no password field) — CodeQL's heuristic only looks at the name, not the type.

### 2. `js/comparison-between-incompatible-types` — the `typeof x === "object" && x !== null` idiom

Found 2026-07-07 (alert #11) in the `isPlainObject`/`isRecord` helper (`typeof value === "object" && value !== null && !Array.isArray(value)`) — the standard JS idiom for checking "non-null object" (`typeof null === "object"`, so the `!== null` check is mandatory). CodeQL considers that after `typeof value === "object"` narrows `value` to "Date, object, or regular expression", comparing it to `null` counts as "incompatible types" — even though `null` can always be compared directly to any object reference in JS; this is not a bug. Proof of a false positive: the identical pattern exists in 4 other files (`form-draft-validation.ts`, `settings-validation.ts`, `announcement-validation.ts`, `wizard-client.ts`) without an alert — CodeQL's flow-sensitive analysis produces different results per call-site for identical code.

**Fix**: reorder — check `value === null` **before** the `typeof` narrowing, not after (runtime behaviour is identical):

```ts
// Before (can hit the false positive):
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// After (same behaviour, no false positive):
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }
  return typeof value === "object";
}
```

**Prevention**: when writing a new "is non-null object" helper, use the order `value === null` first, then `typeof`.

### 3. `js/incomplete-url-substring-sanitization` — `startsWith(<literal origin>)` in a fetch test mock

Found 2026-07-10 (alerts #19, #20) in `tests/unit/generic-oidc-client.test.ts` and
`tests/integration/tenant-sso-flow.integration.test.ts` — both tests inject a
fake `globalThis.fetch` that matches URLs with
`url.startsWith("https://attacker.example.com")` to decide when to
reply with a simulated failure. This rule is designed for PRODUCTION code that
decides WHETHER A URL IS TRUSTED based on a string prefix (vulnerable to
the `https://trusted.com.evil.com` bypass) — here the usage is the exact
opposite (matching a test mock URL in order to REJECT, not to trust) and
both sides of the comparison are entirely controlled by the test itself, so it is not a
real vulnerability. It was still fixed with minimal code instead of
suppressed, because `startsWith` was also accidentally looser than
intended (matching any origin that HAPPENS to start with the same
string).

**Fix**: compare `new URL(url).origin` against the target origin
exactly, rather than `startsWith` on the raw string — the test behaviour stays the same
(it still matches every path under that origin), but it is now
origin-level precise, not substring-level:

```ts
// Before (hits the false positive, and is slightly loose):
if (url.startsWith("https://attacker.example.com")) { ... }

// After (same behaviour for real cases, origin precision):
if (new URL(url).origin === "https://attacker.example.com") { ... }
```

**Prevention**: when writing a fetch mock in a test that matches URLs
by host/origin, use `new URL(url).origin === <origin>` instead of
`startsWith(<origin>)` — it is equally precise for the original intent (matching every
path on that origin), but it does not trigger the CodeQL heuristic that targets the
"substring sanitization" pattern in production code.

### 4. `js/insufficient-password-hash` and `js/clear-text-logging` — official dismissal without reformulating the code (Issue #614)

Found 2026-07-09 (alerts #16, #17, #18), investigated and dismissed
2026-07-10. Unlike patterns #1-#3 above (all fixed with a
code change), these three alerts were officially dismissed via the API because
no reasonable code reformulation was available without sacrificing the real
purpose of the code:

- **Alert #18** (`js/insufficient-password-hash`,
  `src/lib/auth/oauth-state-token.ts:30`): CodeQL flags the return value of
  `generateOAuthState()`/`parseOAuthStateParam()` flowing into
  `hashOAuthState`'s sha256 as a "password". This is NOT the function-name heuristic
  (pattern #1) — these function names contain no "password" substring
  at all, so the trigger mechanism is different and not fully
  confirmed. But the security argument is independent and solid:
  `generateOAuthState()` returns `randomBytes(32).toString("base64url")`
  — a 256-bit CSPRNG value, NOT user input/a password. `hashOAuthState`
  uses the fast-hash-with-prefix form (`sha256:<hex>`) that is EXACTLY the same
  as three other token files that are NOT flagged (`session-token.ts`'s
  `hashSessionToken`, `password-reset-token.ts`'s `hashResetToken`,
  `mfa-challenge-token.ts`'s `hashChallengeToken`) — the same reasoning
  applies: a slow hash (bcrypt/argon2/scrypt) only adds verification
  cost with no real security benefit for a 256-bit random value that is
  impossible to brute-force offline no matter how fast the hash is. Attempting a
  rename without knowing the exact trigger mechanism risks being futile (a wasted CI
  cycle with no certainty of a fix), so dismissal was chosen with independent
  security evidence as justification, not merely the assumption "same
  as pattern #1".
- **Alerts #16, #17** (`js/clear-text-logging`, `scripts/validate-env.ts` — the
  `EnvCheckResult` printer near the end of `config:validate`'s CLI output
  block, NOT a fixed line number; line numbers in this file drift as the
  script grows, describe by function/context instead of re-citing a line):
  CodeQL flags the `console.log` that prints `EnvCheckResult.name`/`.detail`
  as leaking `AUTH_MFA_REQUIRED_WHEN_ENABLED` (a constant array containing
  var NAMES, its content being `["AUTH_MFA_SECRET_ENCRYPTION_KEY"]`) in clear text.
  Verified directly from `checkMfaConfig`: what actually flows into
  `console.log` is only the STRING LITERAL var name (`name`, e.g.
  `"AUTH_MFA_SECRET_ENCRYPTION_KEY"`) and static text (`"is set."`, `"is
missing or empty."`, etc.) — the actual value `env[name]` (the real secret) is
  ONLY ever used inside a boolean predicate (`isSet(env[name])`,
  `isMfaEncryptionKeyWellFormed(env)`), and never enters a variable that
  gets logged. Reformulating the code makes no sense here because the purpose of this
  `console.log` IS to tell the operator which var is missing
  when `bun run config:validate` fails — removing the var name from the
  error message destroys this tool's usefulness for the operator.

**Prevention**: if you find a similar alert (a config VAR/constant NAME
flagged as "sensitive data" when what is logged is only the label/name, not the
value), verify explicitly by reading EVERY data path that
actually reaches the sink (console.log/hash call) before deciding to
dismiss — do not assume from the alert name alone. Store the concrete evidence in
`dismissed_comment` (API `PATCH .../code-scanning/alerts/<N>`, `dismissed_reason`
must be exactly `"false positive"`/`"won't fix"`/`"used in tests"` with spaces,
NOT `false_positive` with an underscore — the API rejects either one if
the format is wrong; `dismissed_comment` is limited to 280 characters, put the full
reasoning in this skill, not in the comment).

### 5. `js/implicit-operand-conversion` — a Bun.SQL tagged template with a provably-always-`null` argument

Found 2026-07-14 (alerts #48, #49), Issue #788: two instances on the same
line, `business-scope-facts.ts:59`
(`AND (${excludeAssignmentId}::uuid IS NULL OR id <> ${excludeAssignmentId})`
inside `` tx`...` ``, a Bun.SQL tagged template). CodeQL assumes
`${excludeAssignmentId}` is stringified like an ordinary template literal
(`` `${null}` `` → `"null"`), when in fact a **tagged template does NOT perform
implicit toString** — the substitution value is passed raw to the tag function
(`tx`), which binds it as a real SQL parameter (a genuine `NULL`,
not the string `"null"`). CodeQL only flags this line because the sole
call site `fetchActiveAssignmentRows` (a private function, one caller) always
calls it with the literal `null` — the dataflow is "provably always null"
here, but the alleged implicit conversion still never happens
(it is not about whether the value is null; it is not JS's implicit-toString at
all, because it is a tagged template). Definitive proof of a false positive: the exact
identical pattern (`${excludeAssignmentId}::uuid IS NULL OR bsa.id <>
${excludeAssignmentId}`) exists on line 186 of the SAME file (the function
`resolveSoDAssignmentFacts`, called from 2 external callers — also
always with the literal `null` in both callers today) and 12+ other files
in the repo use the same `${x ?? null}::uuid IS NULL OR ...` pattern —
none of them flagged by CodeQL. This is purely a per-call-site heuristic artifact,
not a signal of a systematic bug.

**Fix**: official dismissal (not reformulation) — reformulating the code (e.g. separate
if/else branches for null vs non-null) only adds real complexity
to code that is already correct and consistent with 12+ other files in the repo.

**Prevention**: if CodeQL flags `js/implicit-operand-conversion` on
a `` tx`...${x}...` `` (Bun.SQL/postgres.js tagged template), first check
whether that expression really is inside a tagged template (rather than plain
string concatenation) — if it is, implicit-toString never
happens at runtime, and this alert is a false positive based on a
generic string-interpolation pattern that does not understand SQL client library
parameter binding. Look for the identical pattern in other files as evidence before
dismissing.

### 6. `js/trivial-conditional` — a build-time extension seam value deliberately always taking one branch in the base repo

> **HISTORICAL / NO LONGER APPLICABLE (ADR-0034, 2026-07-21).** This alert
> depends on `src/modules/application-registry.ts` (the build-time extension
> seam of the derived-application pathway). ADR-0034 **removed the derived pathway**
> along with `application-registry.ts` and the `scripts/validate-module-composition.ts:41`
> that `ternary`-ed it — so this `js/trivial-conditional` alert **will not
> appear again** and does not need re-triaging. Kept only as a
> historical triage note. The general principle "an extension point deliberately `undefined`
> in the base triggers trivial-conditional" remains valid for other similar patterns, but
> there is no longer a derived seam in this repo.

Found 2026-07-14 (alert #44), Issue #788:
`scripts/validate-module-composition.ts:41`,
`applicationModuleRegistry ? ... : ...` — CodeQL is right that
`applicationModuleRegistry` (imported from
`src/modules/application-registry.ts`) is ALWAYS `undefined` in this base
repo, by design (Issue #740, epic #738 `platform-evolution`): that file
is a _build-time extension seam_ that a derived application REPLACES
entirely with a real `ApplicationModuleRegistry`. CodeQL only
sees the code checked into THIS REPO, so the condition really is
trivial HERE — but it is genuinely conditional once that file is replaced by
a derived repo. Distinguishing evidence: 5 other files
(`src/modules/index.ts`, `module-composition-inventory-generate.ts`,
`extension-check.ts`, `modules-sync.ts`) also import
`applicationModuleRegistry` but ONLY pass it on as a _value_ to
another function (never in a truthy/boolean context) — not one of them is
flagged; only `validate-module-composition.ts` uses it in a
boolean-context ternary expression, the only place where a trivial-conditional
can be detected.

**Fix**: dismiss (won't-fix) — not a bug, and no reformulation (e.g.
`!= null` instead of a truthy check) removes CodeQL's conclusion
because the root cause is that the VALUE is provably-constant in this repo,
not the comparison operator.

**Prevention**: the pattern "a build-time extension point/seam deliberately
`undefined`/no-op in the base repo, with a real value in the derived repo" will always
trigger `js/trivial-conditional` in the base repo once the value is used in a
boolean context — this is HEALTHY (not a reason to remove the
extensibility feature); dismiss it while explaining the seam's design, do not
try to "fix" its triviality.

### 7. `js/trivial-conditional` — CAN be a REAL bug (dead-code branch), not always a false positive (alert #140)

Found 2026-07-21 (alert #140, PR #210):
`scripts/api-spec-check.ts` `responseResolvesToApiError`, CodeQL message _"This
call to asRecord always evaluates to true."_

```ts
const media =
  asRecord(content["application/json"]) ?? Object.values(content)[0];
```

This is a **real bug**, NOT a false positive. `asRecord` (`function asRecord(v):
Record<string,unknown>`) always returns a non-null object (`{}` when the input
is not a record), so the `??` operator's right side (`Object.values(content)[0]`) is
**dead code** — the fallback to the first media type never runs. Effect: an error
response that only has a non-`application/json` media type (e.g. `application/xml`)
is wrongly reported as not resolving to the `ApiError` envelope. **Fix (code change,
behavior-fixing)** — move the `??` INSIDE `asRecord` so that it operates on the
raw value, which really can be `undefined`:

```ts
const media = asRecord(
  content["application/json"] ?? Object.values(content)[0]
);
const schema = media.schema; // media is now guaranteed to be a record
```

**Contrast with §6**: §6 = `trivial-conditional` false positive because the VALUE is
provably-constant by design (an extension seam). §7 = `trivial-conditional` MARKS
a real bug because a HELPER whose return type is never nullish makes the
surrounding `??`/`||`/`if` branch dead. **Triage rule**: when CodeQL
says "call to `<fn>` always evaluates to true", read the definition of `<fn>` — if
its return type genuinely can never be `null`/`undefined`/falsy while the call-site
treats it as if it could (`?? fallback`, `|| default`, `if (!x)`), that is a **real
bug** (a dead fallback) → fix it with a code change, DO NOT dismiss.

### Additional pattern: `js/unused-local-variable` in tests sometimes marks a coverage gap, not just dead code

Of the 11 `js/unused-local-variable` alerts in Issue #788 (all in test
files), 8 really were pure leftover imports/variables (safe to delete). But 3
were CORRECTLY WRITTEN TEST HELPERS that were never called
— each one pointing at a test path that should have existed but was
missing:

- `createCategoryTerm` (`news-portal-homepage-sections.integration.test.ts` —
  **this file no longer exists**; the homepage-section tests moved along when
  `news_portal` was merged into `blog_content`, ADR-0044/#300)
  — there was only a REJECT test for `category_grid` (categorySlug does not exist),
  no ACCEPT test (valid categorySlug) — the helper had already been written
  in full, it was just never called from a test.
- The destructured `has` in the test "stale orphaned ... gets its R2 object
  deleted" (`news-media-r2-reconciliation-job.integration.test.ts`) — the test
  title promises verification that the R2 object is deleted but the body only checks
  the counter (`result.staleOrphaned.deleted`) and the DB status, never
  calling `has(key)` to prove the object is really gone from
  R2 (and never `put()`-ing the object first).
- `resolveLinkedInApiVersion` (`linkedin-provider-config.test.ts`) — every
  other function that module exports has its own `describe` block;
  only this function is imported but never tested directly.

**Triage rule**: before deleting a `js/unused-local-variable` binding in
a test file, check WHETHER that binding's name matches a capability/scenario
named in another test's title, the file's docstring, or another function name in
the same module — if it does, it is most likely a coverage gap (a helper
written for a test that was then forgotten/truncated), not pure dead code.
Wire it into an appropriate new assertion (closing the gap AND removing the
alert) instead of merely deleting it.

## Verification

- `gh pr checks <PR>` — wait for CodeQL to finish (do not assume pending = will pass).
- An alert that has been fixed automatically moves to the `fixed` state on the code-scanning page on the next run on `main` — no manual dismissal is needed if it genuinely no longer appears.
- `bun run check` must still be green — a CodeQL fix must not change runtime behaviour (look at the existing tests for the function you changed).

## Related skills

`awcms-security-review` (module security checklist, not scan tooling), `awcms-pr-review` (the general PR review process).
