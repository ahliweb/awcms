/**
 * session-readers-check.ts — `bun run identity:session-readers:check`.
 *
 * Every file that names `awcms_sessions` is on one of the two lists below, with
 * the reason it is there. Anything else naming it fails the gate, and any file
 * on the LIVE list that does not embed `sessionCredentialCurrent` fails it too.
 * Pure: source text only, no database, no network.
 *
 * ## What it protects
 *
 * Finding A5 (sql/144). A session is "live" when four things hold: it is in this
 * tenant, it is not revoked, it has not expired, and it was minted under the
 * credential its principal holds NOW. The first three are visible in any reader
 * that writes them; the fourth is not, because nothing in a session row hints
 * that a global credential exists to be behind.
 *
 * That asymmetry is the whole risk. The next person adding a session reader will
 * write the three predicates they can see and will not miss the fourth, because
 * nothing tells them it is there. The result is a reader that accepts a session
 * whose password was reset in another tenant — the exact bug A5 records, back
 * again, in a file that reads as correct.
 *
 * `access:grant-readers:check` exists for the same reason one layer up, and
 * ADR-0079 is what happened when nothing did: the writer moved and five readers
 * kept answering about the abandoned table, silently, each looking right.
 *
 * ## Why a two-list shape rather than one
 *
 * Not every file that names the table decides liveness. `logout.ts` revokes;
 * `session-revocation.ts` revokes; the delegated-access sweep revokes. Requiring
 * the fragment there would be actively wrong — it would mean a session that is
 * already dead by epoch cannot be marked `revoked_at`, so the audit record would
 * lose the revocation that did happen. Those files are recorded, and recorded as
 * NOT deciding liveness, which is a claim the next author can check.
 *
 * ## Deny-only
 *
 * Nothing here can make an access decision, permit a read, or widen anything. It
 * fails a build or it says nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { stripComments } from "./lib/source-text";

const SESSION_TABLE = "awcms_sessions";

/** The fragment every live-session reader must embed (`session-credential-epoch.ts`). */
const LIVE_PREDICATE = "sessionCredentialCurrent(";

/** The fragment every session INSERT must embed, so the row is stamped at mint time. */
const MINT_FRAGMENT = "currentCredentialEpoch(";

const INSERT_PATTERN = /INSERT\s+INTO\s+awcms_sessions/i;

export type SessionReaderEntry = {
  /** Repo-relative path, forward slashes. */
  file: string;
  /** Why this file is allowed to name `awcms_sessions`. */
  reason: string;
};

/**
 * Files that decide whether a session row is LIVE. Each must embed
 * `sessionCredentialCurrent`.
 *
 * Eight, which is more than it looks: seven of them independently decide "is
 * this token still good", and before A5 each wrote its own three-predicate
 * version of that question. They still write three predicates; the fourth is now
 * one expression they cannot get subtly different from each other.
 */
export const LIVE_SESSION_READERS: readonly SessionReaderEntry[] = [
  {
    file: "src/modules/identity-access/application/session-lookup.ts",
    reason:
      "THE session read. `resolveActiveSession` is what `auth-context.ts` and `mfa.ts` go through, so it is the one every guarded request pays for."
  },
  {
    file: "src/modules/identity-access/application/session-directory.ts",
    reason:
      "Self-service: `resolveCallerIdentity` (the gate for all three own-session operations) and the own-session listing. A stale-epoch session must neither authenticate nor appear in a list of live ones."
  },
  {
    file: "src/modules/identity-access/application/admin-session-directory.ts",
    reason:
      "Somebody else's sessions, listed for an admin. A session dead by epoch is not live, and showing it would invite an admin to 'revoke' access that was already gone — a screen that lies about what it can end."
  },
  {
    file: "src/modules/identity-access/application/session-introspection.ts",
    reason:
      "`GET /api/v1/auth/session` — the answer a client believes about its own sign-in state."
  },
  {
    file: "src/modules/identity-access/application/mfa-session-assurance.ts",
    reason:
      "Assurance resolution AND session minting. It reads a session to decide aal1/aal2 and it is one of the two INSERT sites, so it is on both counts."
  },
  {
    file: "src/modules/identity-access/application/session-switch.ts",
    reason:
      "MINTS a new session from an existing one. A stale session that could still switch tenants would launder itself into a fresh, fully-stamped session — the epoch's whole point, defeated in one hop."
  },
  {
    file: "src/modules/identity-access/application/delegated-access-redemption.ts",
    reason:
      "Same hazard as the switch, across an organisation boundary: it turns a source-tenant session into access in a partner tenant."
  },
  {
    file: "src/modules/identity-access/application/password-change.ts",
    reason:
      "Changing the password FROM a session. A session holding a credential that was already replaced elsewhere must not be the thing that replaces it again."
  }
];

/**
 * Files that name `awcms_sessions` without deciding liveness. They must NOT be
 * required to embed the fragment, and the reason each is here is the claim.
 */
export const OTHER_SESSION_NAMERS: readonly SessionReaderEntry[] = [
  {
    file: "src/pages/api/v1/auth/login.ts",
    reason:
      "The password INSERT site. It never reads a session; it mints one, and must stamp `credential_epoch` — which is checked separately below."
  },
  {
    file: "src/modules/identity-access/application/session-revocation.ts",
    reason:
      "Bulk REVOKE. Writes `revoked_at`, and deliberately does not filter on the epoch: a session already dead by epoch must still be markable revoked, or the audit trail loses a revocation that really happened."
  },
  {
    file: "src/pages/api/v1/auth/logout.ts",
    reason: "Single-session REVOKE, same reasoning as the bulk one."
  },
  // The delegated-access store and its expiry job are deliberately ABSENT. Both
  // revoke sessions, but neither names the table in code: the store goes through
  // `revokeAllSessionsForIdentity`, and the sweep goes through sql/142's
  // SECURITY DEFINER function. They mention `awcms_sessions` only in prose,
  // which the comment stripper removes — and listing them anyway produced a
  // stale-entry failure on this gate's first run, which is the list keeping
  // itself honest rather than a false alarm.
  {
    file: "src/modules/identity-access/module.ts",
    reason:
      "Descriptors — retention, subject-data and table-ownership declarations about the table, no query."
  }
];

const SOURCE_ROOT = "src";
const SOURCE_EXTENSIONS = [".ts", ".astro"];

function collectSourceFiles(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, into);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      into.push(path);
    }
  }
}

export type SessionReaderProblem = { file: string; message: string };

/**
 * `sources` maps repo-relative path -> file text.
 *
 * Comments are stripped first, and it is load-bearing rather than tidy: three
 * files in this repo mention `awcms_sessions` in a docblock and query it never,
 * and `session-credential-epoch.ts` itself names it only in prose. Asserting on
 * text that includes comments is how a gate ends up pinned to the sentence
 * describing a change rather than to the change.
 */
export function findSessionReaderProblems(
  sources: ReadonlyMap<string, string>,
  live: readonly SessionReaderEntry[] = LIVE_SESSION_READERS,
  others: readonly SessionReaderEntry[] = OTHER_SESSION_NAMERS
): SessionReaderProblem[] {
  const liveFiles = new Set(live.map((entry) => entry.file));
  const otherFiles = new Set(others.map((entry) => entry.file));
  const problems: SessionReaderProblem[] = [];
  const seen = new Set<string>();

  for (const [file, source] of sources) {
    const code = stripComments(source);

    if (!code.includes(SESSION_TABLE)) continue;

    seen.add(file);

    if (liveFiles.has(file)) {
      if (!code.includes(LIVE_PREDICATE)) {
        problems.push({
          file,
          message: `is a recorded LIVE-session reader but does not embed ${LIVE_PREDICATE}). A session is live only when it is also backed by the credential its principal holds NOW (finding A5, sql/144) — without it, a password reset performed in another tenant leaves this reader accepting the old session. Add \`AND \${sessionCredentialCurrent(tx)}\` and alias the table \`s\`.`
        });
      }
    } else if (!otherFiles.has(file)) {
      problems.push({
        file,
        message: `names ${SESSION_TABLE} but is not a recorded session reader. Go through resolveActiveSession (identity-access/application/session-lookup.ts) — or add an entry to LIVE_SESSION_READERS / OTHER_SESSION_NAMERS in scripts/session-readers-check.ts saying which of the two this is and why.`
      });
    }

    if (INSERT_PATTERN.test(code) && !code.includes(MINT_FRAGMENT)) {
      problems.push({
        file,
        message: `inserts into ${SESSION_TABLE} without ${MINT_FRAGMENT}). A session minted without a \`credential_epoch\` is stamped NULL, which reads as epoch 0 — permanently behind for anybody who has ever reset a password, so that account silently cannot stay signed in.`
      });
    }
  }

  for (const entry of [...live, ...others]) {
    if (seen.has(entry.file)) continue;

    problems.push({
      file: entry.file,
      message: `stale entry: this file no longer names ${SESSION_TABLE} (or no longer exists). Remove it — an allow-list entry that outlives its reason is how the list stops describing the repo.`
    });
  }

  return problems;
}

function main(): void {
  const files: string[] = [];
  collectSourceFiles(SOURCE_ROOT, files);

  const sources = new Map(
    files.map((file) => [file, readFileSync(file, "utf8")])
  );
  const problems = findSessionReaderProblems(sources);

  if (problems.length === 0) {
    console.log(
      `identity:session-readers:check OK — ${LIVE_SESSION_READERS.length} live-session reader(s) all embed sessionCredentialCurrent, ${OTHER_SESSION_NAMERS.length} recorded non-liveness namer(s), and every INSERT stamps credential_epoch.`
    );
    return;
  }

  console.error(
    `identity:session-readers:check GAGAL — ${problems.length} temuan.`
  );

  for (const problem of problems) {
    console.error(`  ${problem.file} — ${problem.message}`);
  }

  process.exit(1);
}

if (import.meta.main) {
  main();
}
