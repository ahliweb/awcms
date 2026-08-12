/**
 * #430 — merotasi `x-awcms-tenant-id` tidak lagi mereset penghitung lockout.
 *
 * ADR-0086, Gelombang 7 PR 7.2 of Issue #423. This is the regression test the
 * issue asks for by name, and it is deliberately written against SOURCE rather
 * than behaviour.
 *
 * ## Why source, and not "log in five times and check"
 *
 * A behavioural test needs a database, and the default suite runs without one —
 * so the assertion that matters most would live only in the DB-gated workflow.
 * Worse, a behavioural test passes for the WRONG reason the moment the counter
 * silently falls back to the identity: five failures in one tenant still lock,
 * and the rotation case is the one nobody writes.
 *
 * The property that actually closes #430 is structural: **the row the login path
 * increments must be selected by something an attacker cannot vary.** A
 * tenant-keyed row can be varied by a header; a principal-keyed row cannot,
 * because the principal is keyed on the normalized address alone. That is
 * checkable by reading which writer the login path calls, and it cannot pass for
 * the wrong reason.
 *
 * The DB-gated integration suite covers the behavioural half against real
 * PostgreSQL, where a lockout can actually be provoked.
 */
import { describe, expect, test } from "bun:test";

const LOGIN = "src/pages/api/v1/auth/login.ts";
const STORE = "src/modules/identity-access/application/principal-store.ts";
const RESET = "src/modules/identity-access/application/password-reset.ts";
const CHANGE = "src/modules/identity-access/application/password-change.ts";

async function code(path: string): Promise<string> {
  return (await Bun.file(path).text())
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the counter the login path increments is not tenant-keyed", () => {
  test("failure counts through the PRINCIPAL writer, never the identity columns", async () => {
    const source = await code(LOGIN);

    // The writer that closes #430.
    expect(source).toContain("recordPrincipalLoginFailure(");

    // And the one it replaced must be gone. `failed_login_count` is now history
    // (sql/113); an UPDATE of it here would mean the tenant-scoped counter is
    // still the live one, and every assertion above would be describing a
    // mechanism nothing uses.
    expect(source).not.toMatch(
      /UPDATE\s+awcms_identities[\s\S]{0,200}?failed_login_count/
    );
    expect(source).not.toMatch(
      /UPDATE\s+awcms_identities[\s\S]{0,200}?locked_until/
    );
  });

  test("the lockout DECISION reads the principal, not the identity row", async () => {
    const source = await code(LOGIN);

    // `evaluateLoginAttempt` is fed `failedLoginCount`/`lockedUntil`. If those
    // came from `identityRow`, rotating the tenant header would select a
    // different row and hand the attacker a fresh count — which is #430 exactly.
    expect(source).toMatch(/failedLoginCount:\s*principal\?\./);
    expect(source).toMatch(/lockedUntil:\s*principal\?\./);
    expect(source).not.toMatch(/failedLoginCount:\s*identityRow\./);
    expect(source).not.toMatch(/lockedUntil:\s*identityRow\./);
  });

  test("the principal is resolved by ADDRESS alone — no tenant in the key", async () => {
    const store = await code(STORE);

    // `findPrincipalByEmail` is what the login path calls. Its query must not
    // mention a tenant column, or the global counter would be per-tenant again
    // under a different name.
    const byEmail = store.slice(
      store.indexOf("export async function findPrincipalByEmail"),
      store.indexOf("export async function findPrincipalById")
    );

    expect(byEmail).toContain("WHERE email_normalized =");
    expect(byEmail).not.toContain("tenant_id");
  });

  test("the increment is computed IN-DB, so K parallel attempts cost K", async () => {
    // Issue #483's defect inherited as a fix rather than repeated: a JS
    // read-modify-write means two concurrent failures both read N and both write
    // N+1, so an attacker who stops sending attempts one at a time gets the
    // counter for free.
    const store = await code(STORE);
    const writer = store.slice(
      store.indexOf("export async function recordPrincipalLoginFailure")
    );

    expect(writer).toContain("failed_login_count = failed_login_count + 1");
  });
});

describe("recovery moved with the writer", () => {
  // The "writer moved, readers did not" defect this repo has already paid for.
  // A GLOBAL lockout with a PER-TENANT reset is strictly worse than what it
  // replaced: an attacker who locks a known address out of every tenant could
  // not be undone by the reset mail the victim was just sent.
  // Named per file rather than by one shared substring: reset knows an identity
  // id and change already holds the principal id, so they call different
  // writers. A single loose `toContain("setPrincipalCredential(")` would pass on
  // the `…ForIdentity` variant by prefix and stop distinguishing them.
  test("password reset replaces the PRINCIPAL credential and clears its lockout", async () => {
    expect(await code(RESET)).toContain("setPrincipalCredentialForIdentity(");
  });

  test("password change does the same, via the id it already read", async () => {
    const source = await code(CHANGE);

    expect(source).toMatch(/setPrincipalCredential\(\s*\n?\s*tx/);
    // It must NOT pay for a second identity read to find the principal: the
    // first shape did, and the extra statement moved a neighbouring test's
    // revoked-session count from 2 to 0.
    expect(source).toContain("SELECT password_hash, principal_id");
  });

  test("a successful login clears it too", async () => {
    expect(await code(LOGIN)).toContain("clearPrincipalLockout(");
  });

  test("the clearing writer resets BOTH the count and the expiry", async () => {
    // Clearing only `locked_until` leaves the count at the threshold, so the
    // very next failure re-locks immediately — a recovery that appears to work
    // and lasts one attempt.
    const store = await code(STORE);
    const clear = store.slice(
      store.indexOf("export async function clearPrincipalLockout"),
      store.indexOf("export async function promotePrincipalCredential")
    );

    expect(clear).toContain("failed_login_count = 0");
    expect(clear).toContain("locked_until = NULL");
  });
});

describe("the migration cannot weaken the control it moves", () => {
  test("the backfill takes MAX, so an in-flight lockout survives deploy", async () => {
    const migration = await Bun.file(
      "sql/113_awcms_principal_lockout.sql"
    ).text();

    expect(migration).toContain("MAX(failed_login_count)");
    expect(migration).toContain("MAX(locked_until)");
    // Taking 0 — or whichever row sorted first — would release every locked
    // account at the moment of deploy.
    expect(migration).not.toMatch(/SET\s+failed_login_count\s*=\s*0/);
  });

  test("credential promotion is one-way and cannot clobber a live hash", async () => {
    const store = await code(STORE);
    const promote = store.slice(
      store.indexOf("export async function promotePrincipalCredential"),
      store.indexOf("export async function setPrincipalCredential")
    );

    // Without `AND password_hash IS NULL`, a stale identity hash from a tenant
    // whose row was never updated could overwrite the credential the human
    // actually uses.
    expect(promote).toContain("password_hash IS NULL");
  });
});

describe("every success path clears the GLOBAL counter, not just /auth/login", () => {
  // Found by grepping for leftover writers rather than by reasoning: two more
  // paths authenticate a human without a password and cleared only the
  // tenant-scoped copy. A person locked out by password attempts would sign in
  // through their IdP successfully and stay locked at the password path, with
  // the lever that used to release them no longer deciding anything.
  const FEDERATED = [
    "src/pages/api/v1/auth/sso/[providerKey]/callback.ts",
    "src/pages/api/v1/auth/mfa/totp/enroll/verify.ts"
  ];

  test("SSO callback and MFA enrolment clear the principal lockout", async () => {
    for (const path of FEDERATED) {
      expect(await code(path)).toContain("clearPrincipalLockoutForIdentity(");
    }
  });

  test("and none of them still writes the retired identity counter", async () => {
    for (const path of [...FEDERATED, LOGIN]) {
      expect(await code(path)).not.toMatch(
        /UPDATE\s+awcms_identities[\s\S]{0,200}?failed_login_count/
      );
    }
  });
});

describe("a new identity is born WITH a principal", () => {
  // The defect the DB-gated suite found, and the one no pure gate could:
  // `sql/112` backfilled the identities that existed WHEN IT RAN, and nothing
  // taught the writers to create one afterwards. Every account created after the
  // migration landed with `principal_id = NULL` — and since the counter lives on
  // the principal, a null link means failed attempts count NOTHING.
  //
  // A brute-force control silently switched off for exactly the accounts nobody
  // has audited yet. The code was correct in isolation and the tables were
  // correct in isolation; only asking a real database for the row found it.
  const IDENTITY_WRITERS = [
    "src/modules/tenant-admin/application/platform-bootstrap.ts",
    "src/modules/identity-access/application/membership-materialization.ts",
    "src/modules/identity-access/application/self-registration.ts",
    "src/modules/identity-access/application/tenant-sso.ts"
  ];

  test("every file that INSERTs an identity also links a principal", async () => {
    for (const path of IDENTITY_WRITERS) {
      const source = await code(path);

      expect(source).toContain("INSERT INTO awcms_identities");
      expect(source).toContain("linkIdentityToPrincipal(");
    }
  });

  test("and the list is DERIVED, so a fifth writer cannot be forgotten", async () => {
    // The assertion above is only as good as its list. This one rebuilds the
    // list from the repository, so a new writer joins it whether or not anybody
    // remembered to add it here.
    const found: string[] = [];

    for (const path of new Bun.Glob("src/**/*.ts").scanSync(".")) {
      if ((await code(path)).includes("INSERT INTO awcms_identities")) {
        found.push(path);
      }
    }

    expect(found.sort()).toEqual([...IDENTITY_WRITERS].sort());
  });
});
