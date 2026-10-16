import { describe, expect, test } from "bun:test";
import { restoreRole } from "../src/modules/identity-access/application/role-admin";
import {
  readPreferences,
  resolvePrincipalIdForIdentity
} from "../src/modules/identity-access/application/principal-preference-store";

// Fake tx with PostgreSQL semantics: an error aborts the transaction (every
// later statement fails with 25P02) unless it was raised inside a savepoint.
const PgError = (Bun.SQL as unknown as { PostgresError: { prototype: object } })
  .PostgresError;

function pgError(errno: string): Error {
  const e = Object.create(PgError.prototype) as Error & { errno: string };
  e.errno = errno;
  e.message = errno;
  return e;
}

function fakeTx(failOn: string, failErrno: string, ok: unknown[] = []) {
  let aborted = false;
  const tx = (async (s: TemplateStringsArray) => {
    if (aborted) throw pgError("25P02");
    if (s.join("?").includes(failOn)) {
      aborted = true;
      throw pgError(failErrno);
    }
    return ok;
  }) as unknown as Bun.TransactionSQL;
  (tx as { savepoint: unknown }).savepoint = async (
    fn: (sp: unknown) => Promise<unknown>
  ) => {
    const saved = aborted;
    try {
      return await fn(tx);
    } catch (e) {
      aborted = saved;
      throw e;
    }
  };
  return tx;
}

describe("g14: savepoints keep the transaction usable", () => {
  test("restoreRole: 23505 on restore surfaces DuplicateRoleCodeError, not 25P02", async () => {
    const tx = fakeTx("UPDATE awcms_roles", "23505", [{ role_code: "editor" }]);
    const err = await restoreRole(tx, "t", "u", "r").catch((e: unknown) => e);
    expect((err as Error)?.constructor?.name).toBe("DuplicateRoleCodeError");
  });

  test("readPreferences: a read fault degrades and leaves the tx usable", async () => {
    const tx = fakeTx("awcms_principal_preferences", "42501");
    const prefs = await readPreferences(tx, "p1");
    expect(prefs).toEqual({ locale: null, theme: null, timeZone: null });
    await expect(tx`SELECT 1`).resolves.toEqual([]);
  });

  test("resolvePrincipalIdForIdentity: a read fault returns null and leaves the tx usable", async () => {
    const tx = fakeTx("awcms_identities", "42501");
    expect(await resolvePrincipalIdForIdentity(tx, "t", "i")).toBeNull();
    await expect(tx`SELECT 1`).resolves.toEqual([]);
  });
});
