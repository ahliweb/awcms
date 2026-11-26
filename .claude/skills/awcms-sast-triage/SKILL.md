---
name: awcms-sast-triage
description: Triage and fix AWCMS static-analysis (SAST) findings from OpenGrep, the engine of the `keamanan / sast-rahasia-dependensi` check (ADR-0173). Use when that check fails on a PR, when asked to "triage SAST"/"fix an OpenGrep finding", when working an entry of `tools/ci/sast/baseline.json`, or when adding a local rule. Covers the gate semantics (only a new ERROR outside the baseline fails), the shrink-only baseline, reasoned `nosemgrep` suppressions, local rules, and the tool-independent lessons kept from the retired CodeQL catalogue (name heuristics, dead `??` fallbacks that are real bugs, unused test bindings that mark a coverage gap).
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — SAST Triage (OpenGrep)

Static analysis runs in `.github/workflows/keamanan.yml`, job `keamanan / sast-rahasia-dependensi`, on every pull request and every push to `main` ([ADR-0173](../../../docs/adr/0173-static-analysis-runs-on-opengrep-with-a-pinned-copied-rule-set-and-a-shrink-only-baseline-and-codeql-is-retired.md)). It replaced CodeQL. The same job also runs gitleaks over the commit range; this skill covers the SAST step only.

- **Engine:** OpenGrep `v2.1.0`, pinned by SHA-256 and verified before execution by `tools/ci/sast/opengrep-scan.ts`.
- **Rules:** `tools/ci/sast/rules/javascript/`, `tools/ci/sast/rules/typescript/` and `tools/ci/sast/rules/yaml/github-actions/` (a byte copy of `opengrep/opengrep-rules` at a pinned commit, see `tools/ci/sast/rules/SUMBER.md`) plus this repo's own rules in `tools/ci/sast/rules/lokal/`. No registry rules are ever fetched.
- **Gate:** exit `1` only for an `ERROR` finding whose fingerprint is not in `tools/ci/sast/baseline.json`. `WARNING` and `INFO` are printed and never block. Exit `2` is a tool failure (download, checksum, rules, baseline) and fails closed.
- **Not covered:** `.astro` files (no parser) and `design/` (excluded, ADR-0173 §Coverage). The workflow files under `.github/workflows/` ARE scanned, by the nine `yaml/github-actions/` rules; those are pattern rules, shallower than CodeQL's data-flow analysis of workflows.

## Triage steps (mandatory, do not guess)

1. **Read the finding from the failed job, not from memory.** `gh pr checks <PR>` gives the job URL; `gh run view <run-id> --log-failed` shows each new `ERROR` as `[ERROR] <path>:<line>  <rule-id>` followed by the rule message. The summary line gives counts per severity and the number of stale baseline entries.
2. **Reproduce it** with the same command CI runs, from the repo root:
   ```bash
   bun tools/ci/sast/opengrep-scan.ts --exclude design
   ```
   On the owner's workstation every CI command goes through `ci-lokal` (60-second limit, internal cross-portfolio standard DL-099). A full scan of this repo takes longer than that (about 77 s on the GitHub-hosted runner at adoption), so the full scan runs in CI; locally, read the rule and the code instead of looping the scan.
3. **Read the rule before the code.** The rule file is `tools/ci/sast/rules/<language>/.../<name>.yaml` (the id `javascript.browser.security.insecure-innerhtml` maps to `tools/ci/sast/rules/javascript/browser/security/insecure-innerhtml.yaml`). The `pattern`/`patterns` block says exactly what matched; the `message` and `metadata` say why it matters. Most copied rules match a pattern within one function: they do not know where a value came from.
4. **Decide: real defect, or a match that cannot be a defect here.** Prove it either way before writing code:
   - Follow every data path into the matched sink. A value that is provably a constant, a server-generated random token, or already escaped is evidence; "it looks fine" is not.
   - Look for the same shape elsewhere in the repo. If other call sites carry the same risk, the fix belongs in a shared helper, not in one file.
5. **Fix with a minimal, behaviour-preserving change** when it is a real defect, with a test that fails before the fix. Then run `bun tools/ci/sast/opengrep-scan.ts baseline --rapikan` if the finding was in the baseline: the entry is now stale and must leave it.
6. **When it is not a defect and the code cannot reasonably be reshaped**, suppress that one line inline, with the full rule id and a reason on the same line or the line directly above:
   ```ts
   // nosemgrep: javascript.browser.security.insecure-innerhtml -- markup is built from escapeHtml() output only, see the test "escapes every interpolated field"
   ```
   A suppression without a reason is rejected in review. Prefer reshaping the code when it costs little, because a suppression hides the line from every future rule version too.
7. **Verify:** the job is green on the PR, and the summary line shows no new `ERROR`.

## The baseline only shrinks

- `tools/ci/sast/baseline.json` holds the `ERROR` findings that existed when the gate was adopted (16 entries, listed in ADR-0173 §Adoption measurement). Each entry is `{ rule, path, fingerprint, alasan, baris }`; `fingerprint` (rule id + path + whitespace-collapsed matched text + occurrence index) is the key, `baris` is informational.
- `baseline --buat` only works when no baseline exists; it will not run again.
- `baseline --rapikan` removes stale entries and never adds one. `scan` reports how many entries are stale.
- **An agent never adds a baseline entry.** Adding one is a hand edit with a non-empty `alasan`, reviewed by a human in the PR; an entry without `alasan` makes the script exit `2`.
- Working an adoption entry means triaging it with the steps above in its own issue, then fixing or suppressing it, then `--rapikan`.

## Adding a local rule

Put a `.yaml` file in `tools/ci/sast/rules/lokal/` (the sync never touches that folder; `larang-eval.yaml` is the example). Fill `metadata.alasan`, choose the severity deliberately (`ERROR` blocks merges), and scan the repo with it before opening the PR: every existing match of a new `ERROR` rule is a new failure, and the baseline cannot absorb it without a human review.

## Changing the engine or the rule pin

Both pins live in `tools/ci/sast/opengrep-scan.ts` (`OPENGREP_VERSION`, `OPENGREP_ASSETS`, `RULES_COMMIT`), and the engine pin is repeated in `keamanan.yml` as the cache key. A pin change is its own PR: verify the release digest, sync the rules with `bun tools/ci/sast/opengrep-scan.ts sinkron-aturan`, review the rule diff, and handle new `ERROR` findings through the triage steps, never by re-creating the baseline.

## Lessons kept from the CodeQL era

CodeQL ran here until ADR-0173 and its alerts taught patterns that do not depend on the tool. The code comments that cite CodeQL rule ids (for example in `src/lib/auth/reset-token.ts`) are kept as the record of why that code is shaped the way it is.

1. **Name heuristics are not data flow.** CodeQL's `js/insufficient-password-hash` flagged any function whose name contained "password", whatever it returned (Issue #496, PR #505). The fix that worked was renaming (`hashResetToken`, `validateForgotIdentifierInput`); an inline suppression did not remove the alert. When a scanner's message names something the data flow makes impossible, that is proof of a false positive.
2. **Check `value === null` before `typeof value === "object"`.** The reverse order is correct JavaScript but tripped `js/comparison-between-incompatible-types`; the reordered helpers in `src/modules/email/domain/announcement-validation.ts` and `src/modules/form-drafts/domain/form-draft-validation.ts` carry the comment.
3. **Compare origins, not prefixes.** `url.startsWith("https://host")` in a test mock was flagged as substring sanitization and was also looser than intended; `new URL(url).origin === "https://host"` is exact and kept the behaviour.
4. **A "condition is always true" finding can be a real bug.** When a helper never returns `null`/`undefined` but its call site writes `helper(x) ?? fallback`, the fallback is dead code (alert #140, PR #210). Move the `??` inside the call, onto the value that really can be missing. Read the helper's definition before dismissing a trivial-conditional finding.
5. **Tagged templates do not stringify.** A Bun.SQL `` tx`... ${x} ...` `` passes `x` as a bound parameter; a finding that assumes implicit `toString()` there is a false positive (Issue #788).
6. **An unused binding in a test can mark a missing test.** Before deleting an unused helper or an overwritten `result` in a test, check whether a test title, a comment or the module's exports promise the scenario it would have covered; if so, add the assertion instead (Issue #788, alert #204, PR #1293).
7. **Dismissals need evidence a reader can check.** Where a finding was accepted (Issue #614), the reasoning named every data path into the sink. The same standard applies to a `nosemgrep` reason now.

## Related skills

`awcms-security-review` (module security checklist), `awcms-security-hardening` (OWASP mapping), `awcms-pr-review` (the general PR review process).
