🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0173-static-analysis-runs-on-opengrep-with-a-pinned-copied-rule-set-and-a-shrink-only-baseline-and-codeql-is-retired.id.md)

# ADR-0173 — Static analysis runs on OpenGrep with a pinned, copied rule set and a shrink-only baseline, and CodeQL is retired

- **Status:** Accepted
- **Accepted:** 2026-11-27 (owner decision for every repository of the portfolio, internal cross-portfolio standard DL-098). The owner also decided the same day that the Actions workflow coverage is replaced, not dropped (Decision 2). One question stays open (see "Open questions"); it does not block the decision.
- **Date:** 2026-11-27
- **Decision maker:** @ahliweb (owner). Merging the pull request that applies this ADR, and changing the `main` ruleset, are the owner's own acts.
- **Related:** PR [#1530](https://github.com/ahliweb/awcms/pull/1530) (applies this ADR); [`SECURITY.md`](../../SECURITY.md); [`branch-protection.md`](../awcms/branch-protection.md) (required checks, ruleset `11653326`); [`dependency-governance.md`](../awcms/dependency-governance.md) (where the dependency audit runs); [`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.md) gaps C4 and C16 (`.astro` coverage); [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (skills are gated, so the triage skill is replaced rather than left pointing at a removed workflow).

## Context

Until this ADR, static analysis was GitHub CodeQL: `.github/workflows/codeql.yml` ran a matrix of `actions` and `javascript-typescript` (`build-mode: none`, query suites `security-extended` and `security-and-quality`) on every push and pull request to `main` and weekly, excluded `design/` through `.github/codeql/codeql-config.yml`, and uploaded SARIF to GitHub code scanning. Three contexts from it are required by the `main` ruleset `11653326`: `Analyze (javascript-typescript)`, `Analyze (actions)` and `CodeQL` (the code-scanning app). `tests/codeql-coverage-statement.test.ts` kept the workflow's coverage statement honest, and the skill `awcms-codeql-triage` carried the triage process and a catalogue of confirmed false positives.

The owner decided on 27 November 2026 that CodeQL runs in no repository of the portfolio. The GitHub CodeQL terms restrict its use on code that is not open source and in CI without a GitHub Advanced Security licence. This repository is public and MIT-licensed, so the restriction does not bite here today. The owner nevertheless chose **one path for every repository, public ones included**, for two reasons that do apply here:

1. Repositories that embed this one as a subtree (the downstream deployments that absorb `awcms` into their own tree) are not all public. A workflow or a skill that is correct here is copied into them on the next sync, where it would not be.
2. One security leg with the same check name in every repository is one thing to maintain, explain and require; two tool stacks chosen by licence status are two.

## Decision

1. **CodeQL is removed from every path that runs.** Deleted: `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml`, `tests/codeql-coverage-statement.test.ts`. The skill `awcms-codeql-triage` is replaced by `awcms-sast-triage` (OpenGrep triage: baseline, reasoned `nosemgrep`, local rules), which keeps the tool-independent lessons of the old catalogue. Code comments that record why a function was named or shaped after a CodeQL finding stay: they are history and still explain the code.
2. **A separate workflow, `.github/workflows/keamanan.yml`, job `keamanan / sast-rahasia-dependensi`,** runs on every pull request, on pushes to `main` and on demand, on a GitHub-hosted `ubuntu-24.04` runner, with `permissions: contents: read`, every action pinned to a commit SHA, no `paths` filter and no SARIF upload. It holds two steps:
   - **Secrets:** gitleaks `8.30.1`, the release archive verified against its SHA-256 before use, run with `--redact` over the **commit range** of the event (pull request `base..head`, push `before..after`, otherwise the tip commit). It never scans the whole history. The repository has no gitleaks configuration, so the built-in rules apply. GitGuardian stays as it is.
   - **SAST:** `bun tools/ci/sast/opengrep-scan.ts --exclude design`. OpenGrep `v2.1.0` (LGPL-2.1), binary `opengrep_linux_x86` pinned by SHA-256 `d6a68a84c01a3d8ee933f60847decf1b4d0fd7791a26833b32b95922baf28974` and verified before it is executed. Rules: a byte copy of `opengrep/opengrep-rules` at commit `f1d2b562b414783763fd02a6ed2736eaed622efa`, every `.yaml` and `.yml` rule under `javascript/` and `typescript/` (203 files) and the nine rules under `yaml/github-actions/` (rule-test fixtures `*.test.yaml` and `*.fixed.yaml` are not copied), 212 rule files in all, plus the upstream `LICENSE`, in `tools/ci/sast/rules/`, plus this repository's own rules in `tools/ci/sast/rules/lokal/`. The Semgrep Registry (`p/...`) and `semgrep/semgrep-rules` are not used. The engine runs with `SEMGREP_SEND_METRICS=off`, `--disable-version-check`, `--x-ignore-semgrepignore-files` and `--jobs` from `CI_LOKAL_CPUS` (default 5); OpenGrep 2.1.0 rejects `--metrics`, so that option is not passed.
3. **The gate fails only on an `ERROR` finding that is not in the baseline** (`tools/ci/sast/baseline.json`). `WARNING` and `INFO` are reported in the log and never block. Exit codes: `0` pass, `1` new `ERROR`, `2` tool failure (download, checksum, empty or broken rules, broken baseline: fail closed).
4. **The baseline only shrinks.** It was created once, at adoption, and the script refuses to create it again. `baseline --rapikan` drops stale entries and never adds one. A new entry is a hand edit with a non-empty `alasan`, reviewed by a human in the pull request; an agent does not add baseline entries. A finding accepted for one line is suppressed inline with `// nosemgrep: <rule-id> -- <reason>`, never without a reason.
5. **The dependency audit is not duplicated.** `bun run deps:audit:check` already gates every pull request inside the `check` chain of `ci.yml` (job "Quality"), with its threshold and exception ledger unchanged. `dependency-freshness.yml` (`bun outdated`, `bun audit`, image pins) stays a weekly and on-demand report, not a pull-request gate.
6. **Results are not uploaded to GitHub code scanning.** The existing code-scanning alerts stay in GitHub as they were last reported; nothing updates or closes them after this ADR.

## Coverage

- **Scanned:** the tracked `.ts`, `.js` and `.mjs` sources and the workflow files under `.github/workflows/`, minus the script's default exclusions (dependencies, build output, generated graph and report folders, `*.min.js`, the copied rules themselves) and `design/`. `design/` is excluded for the reason the CodeQL configuration recorded: an exported design canvas and a byte-identical vendored copy of a third-party runtime, reference-only, never shipped and never imported by `src/`. Moving any of it into `src/` makes it subject to the scan. The `State coverage` step of `keamanan.yml` writes these counts into the run summary at run time (never by hand), and `tests/sast-coverage-statement.test.ts` keeps that step, the SHA pins, the absent `paths` filter and the single exclusion from being removed quietly; it takes over from the deleted CodeQL coverage test.
- **Not scanned, unchanged:** `.astro` files. OpenGrep has no Astro parser, exactly as CodeQL had no Astro extractor, so gaps C4 and C16 describe the same uncovered surface as before.
- **`Analyze (actions)` is replaced, at a shallower depth.** The analysis of the workflow files themselves (script injection through `${{ }}` in `run:`, untrusted checkout in privileged triggers) is covered by the nine `yaml/github-actions/` rules from the same pinned commit (owner decision of 27 November 2026). They are pattern rules over the YAML, not CodeQL's data-flow analysis of the workflow, so they find fewer and shallower cases.
- **Lost compared with CodeQL:**
  1. **Inter-procedural taint tracking.** CodeQL's `security-extended` queries follow data across functions and files; the copied OpenGrep rules are mostly pattern rules within one function. Fewer deep data-flow findings are expected.
  2. **The `security-and-quality` suite.** Quality queries such as unused locals have partial cover in `tsc` (`noUnusedLocals`, `noUnusedParameters`), not a replacement.

## Adoption measurement

Taken on the GitHub-hosted runner, because the same scan exceeded the 60-second limit that applies to CI run on the owner's workstation (internal cross-portfolio standard DL-099): 213 rule files (212 copied + 1 local), 4,740 files scanned, 76.7 s; `ERROR` 16, `WARNING` 862, `INFO` 701. The nine `yaml/github-actions` rules report no finding (of any severity) in the repository's workflow files. The 16 `ERROR` findings, all from the JavaScript and TypeScript rules, form the adoption baseline:

| Rule                                                   | Entries | Where                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript.node-crypto.security.gcm-no-tag-length`    | 5       | `src/lib/auth/mfa-secret-crypto.ts`, `src/lib/auth/sso-credential-crypto.ts`, `src/lib/security/field-encryption.ts`, `src/lib/security/secure-url-params.ts`, `src/modules/comments/domain/subscriber-crypto.ts` |
| `javascript.browser.security.insecure-document-method` | 4       | `public/js/blog-preview-overlay.js` (2), `src/lib/ui/blog-preview-overlay.ts` (2)                                                                                                                                 |
| `javascript.browser.security.insecure-innerhtml`       | 4       | `public/js/blog-preview-overlay.js` (2), `src/lib/ui/blog-preview-overlay.ts` (2)                                                                                                                                 |
| `typescript.lang.correctness.useless-ternary`          | 3       | `src/modules/hr-commission/domain/hr-commission-decimal.ts`, `src/modules/tax/domain/decimal.ts`, `tests/omes-control-repository-progress-poller.test.ts`                                                         |

They are recorded, not triaged: the change that applies this ADR does not modify product code. Each one is triaged with the skill `awcms-sast-triage` in its own issue; a fixed finding leaves the baseline through `baseline --rapikan`.

## Consequences

- **Positive:** one security leg with one check name across the portfolio; no licence question when this tree is copied into a private repository; the rule set and the engine are pinned and verifiable, so a scan result is reproducible from the commit alone; secrets are scanned per change by a second, independent tool next to GitGuardian.
- **Negative / trade-off:** the coverage listed under "Lost compared with CodeQL"; findings live in job logs instead of the code-scanning tab, so there is no alert history or dismissal record; the copied rules come from an upstream repository that is archived, so new rules arrive only by a deliberate pin change.
- **Licence of the copied rules:** `tools/ci/sast/rules/` (except `lokal/`) is under Commons Clause + LGPL 2.1, not under this repository's MIT licence. Commons Clause withholds the right to sell the software; using the rules in CI is not restricted. Open question Q1.
- **Required checks:** until the owner changes ruleset `11653326`, the three CodeQL contexts are still required and never report, so no pull request, this one included, can merge without that change. See "Owner actions".

## Owner actions

1. In ruleset `11653326` ("main only"), remove the required contexts `Analyze (javascript-typescript)`, `Analyze (actions)` and `CodeQL`, and add `keamanan / sast-rahasia-dependensi`. The exact commands are in [`branch-protection.md`](../awcms/branch-protection.md) §"Retiring CodeQL (ADR-0173)".
2. Optionally disable CodeQL "default setup" in the repository's code-security settings if it was ever enabled there (this repository used the advanced, workflow-based setup).

## Rollback

Revert the pull request that applies this ADR: it restores `codeql.yml`, its configuration, the coverage test and the skill, and removes `keamanan.yml`, `tools/ci/sast/` and this ADR's status. The owner then restores the three CodeQL contexts in ruleset `11653326` and removes `keamanan / sast-rahasia-dependensi`.

## Alternatives considered

- **Keep CodeQL here, because this repository is public.** Rejected by the owner: the subtree copies are not all public, and one path is preferred over a per-repository licence judgement.
- **Semgrep Registry rules (`p/...`) or `semgrep/semgrep-rules`.** Excluded by the owner's decision; a registry fetched at scan time is also neither pinned nor reproducible.
- **Upload OpenGrep SARIF to code scanning.** Rejected: it depends on the same GitHub Advanced Security feature for private repositories, and the leg must behave the same everywhere.

## Open questions for the owner

1. **Q1, licence notice.** Should the README or `LICENSE` state that `tools/ci/sast/rules/` is third-party material under Commons Clause + LGPL 2.1, so that a downstream copy of this MIT template does not mistake it for MIT? The directory already carries the upstream `LICENSE` and a `SUMBER.md` provenance note.
