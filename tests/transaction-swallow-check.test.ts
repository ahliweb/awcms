/**
 * `db:transaction-swallow:check` (Issue #1099) — the gate that stops a catch
 * from swallowing a failed statement of an open transaction without a
 * savepoint.
 *
 * The cases are written as the shapes that actually existed in `src/` (a
 * duplicate-key INSERT mapped to `duplicate_key`; a best-effort statement
 * followed by `.catch(() => null)`), so the gate is proved red on the
 * mutations it exists for, and proved quiet on the forms the convention allows.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  findTransactionSwallows,
  sanitize
} from "../scripts/transaction-swallow-check";

const FILE = "src/modules/example/application/example.ts";

function findings(source: string) {
  return findTransactionSwallows(FILE, source);
}

describe("transaction-swallow-check: red on a swallowed failed statement", () => {
  test("a duplicate-key INSERT caught and mapped without a savepoint", () => {
    const hits = findings(`
      export async function createThing(tx: Bun.TransactionSQL) {
        try {
          return await tx\`INSERT INTO awcms_things (a) VALUES (1) RETURNING id\`;
        } catch (error) {
          if (isUnique(error)) {
            return { outcome: "duplicate_key" };
          }
          throw error;
        }
      }
    `);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.scope).toBe("createThing");
    expect(hits[0]!.kind).toBe("try_catch");
  });

  test("a bare catch that returns a value", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`UPDATE t SET a = 1\`;
          } catch {
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("an empty catch (swallow and fall through)", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`SELECT 1\`;
          } catch (error) {
            log(error);
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a helper that receives the transaction handle", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await grantRole(tx, 1);
          } catch (error) {
            return refuse(error);
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a handle declared as Bun.TransactionSQL under any name", () => {
    expect(
      findings(`
        async function run(handle: Bun.TransactionSQL) {
          try {
            await handle\`SELECT 1\`;
          } catch {
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a transaction handle with an unconventional name (sql.begin callback param)", () => {
    expect(
      findings(`
        async function run(sql) {
          return sql.begin(async (conn) => {
            try {
              await conn\`INSERT INTO t VALUES (1)\`;
            } catch {
              return "duplicate";
            }
          });
        }
      `)
    ).toHaveLength(1);
  });

  test("a promise-level .catch swallowing a tx statement", () => {
    const hits = findings(`
      async function run(tx) {
        await promote(tx, 1).catch(() => null);
        await lease(tx);
      }
    `);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("promise_catch");
  });

  test("a savepoint around a DIFFERENT statement does not cover the failing one", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx.savepoint((sp) => sp\`SELECT 1\`);
            await tx\`INSERT INTO t VALUES (1)\`;
          } catch {
            return "duplicate";
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a throw that is not the last statement still lets the catch complete", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`SELECT 1\`;
          } catch (error) {
            if (isUnique(error)) {
              throw new Duplicate();
            }
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("the savepoint callback is NOT in scope for a catch inside it (nested)", () => {
    // The catch is OUTSIDE the savepoint here: nothing guards the statement.
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`INSERT INTO t VALUES (1)\`;
          } catch (error) {
            return { ok: false };
          } finally {
            cleanup();
          }
        }
      `)
    ).toHaveLength(1);
  });
});

describe("transaction-swallow-check: quiet on the allowed forms", () => {
  test("the statement runs in tx.savepoint", () => {
    expect(
      findings(`
        async function createThing(tx: Bun.TransactionSQL) {
          try {
            return await tx.savepoint(
              (sp) => sp\`INSERT INTO awcms_things (a) VALUES (1) RETURNING id\`
            );
          } catch (error) {
            if (isUnique(error)) {
              return { outcome: "duplicate_key" };
            }
            throw error;
          }
        }
      `)
    ).toEqual([]);
  });

  test("a helper call wrapped in a savepoint", () => {
    expect(
      findings(`
        async function run(tx: Bun.TransactionSQL) {
          try {
            await tx.savepoint((sp) => grantRole(sp, 1));
          } catch {
            return "refused";
          }
        }
      `)
    ).toEqual([]);
  });

  test("a catch that always ends in throw is a mapping, not a swallow", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`INSERT INTO t VALUES (1)\`;
          } catch (error) {
            log(error);
            throw new Mapped(error);
          }
        }
      `)
    ).toEqual([]);
  });

  test("an explicit SAVEPOINT / ROLLBACK TO SAVEPOINT pair", () => {
    expect(
      findings(`
        async function run(tx) {
          await tx.unsafe("SAVEPOINT s1");
          try {
            await tx\`INSERT INTO t VALUES (1)\`;
            await tx.unsafe("RELEASE SAVEPOINT s1");
          } catch (error) {
            await tx.unsafe("ROLLBACK TO SAVEPOINT s1");
            return { ok: false };
          }
        }
      `)
    ).toEqual([]);
  });

  test("a catch AROUND a whole nested transaction is outside it", () => {
    expect(
      findings(`
        async function handler(sql) {
          try {
            return await withTenant(sql, "t", async (tx) => {
              await tx\`INSERT INTO t VALUES (1)\`;
              return 1;
            });
          } catch (error) {
            return fail(500);
          }
        }
      `)
    ).toEqual([]);

    expect(
      findings(`
        async function handler(sql) {
          try {
            return await runWorkerTenantWork("t", async (tx) => {
              await tx\`SELECT 1\`;
            });
          } catch (error) {
            return rejected();
          }
        }
      `)
    ).toEqual([]);
  });

  test("code that never touches a transaction handle (pool, fetch, parse)", () => {
    expect(
      findings(`
        async function run(sql) {
          try {
            await sql\`SELECT 1\`;
          } catch {
            return null;
          }
        }
        async function parse(text) {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        }
      `)
    ).toEqual([]);
  });

  test("a reviewed exception written in place with a reason", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await startWorkflow(tx);
          } catch (error) {
            // tx-swallow-ok: raised by a read-only check before any write
            if (error instanceof NotConfigured) {
              return { outcome: "not_configured" };
            }
            throw error;
          }
        }
      `)
    ).toEqual([]);
  });

  test("a marker with no reason does NOT exempt", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await startWorkflow(tx);
          } catch (error) {
            // tx-swallow-ok:
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("an allowlist entry exempts exactly its file#scope", () => {
    const source = `
      async function createThing(tx) {
        try {
          await tx\`INSERT INTO t VALUES (1)\`;
        } catch {
          return null;
        }
      }
    `;

    expect(
      findTransactionSwallows(FILE, source, { [`${FILE}#createThing`]: "ok" })
    ).toEqual([]);
    expect(
      findTransactionSwallows(FILE, source, { [`${FILE}#other`]: "ok" })
    ).toHaveLength(1);
  });
});

describe("transaction-swallow-check: callees that MAP a database error (Issue #1099 audit M1)", () => {
  test("a catch that always rethrows but maps a unique violation to a domain error, with no savepoint", () => {
    const hits = findings(`
      export async function createOffice(tx: Bun.TransactionSQL) {
        try {
          return await tx\`INSERT INTO awcms_offices (a) VALUES (1)\`;
        } catch (error) {
          if (
            error instanceof Bun.SQL.PostgresError &&
            String(error.errno) === "23505"
          ) {
            throw new DuplicateOfficeCodeError("x");
          }
          throw error;
        }
      }
    `);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.scope).toBe("createOffice");
  });

  test("the same mapping with the statement in a savepoint is quiet", () => {
    expect(
      findings(`
        export async function createOffice(tx: Bun.TransactionSQL) {
          try {
            return await tx.savepoint((sp) => sp\`INSERT INTO awcms_offices (a) VALUES (1)\`);
          } catch (error) {
            if (error instanceof Bun.SQL.PostgresError && String(error.errno) === "23505") {
              throw new DuplicateOfficeCodeError("x");
            }
            throw error;
          }
        }
      `)
    ).toEqual([]);
  });

  test("a constraint-name mapping (message.includes) with a rethrown domain error", () => {
    expect(
      findings(`
        async function create(tx) {
          try {
            await tx\`INSERT INTO t VALUES (1)\`;
          } catch (error) {
            if (String(error.message).includes("t_key_dedup")) {
              throw new Conflict();
            }
            throw error;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a plain log-and-rethrow is not a mapping", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`SELECT 1\`;
          } catch (error) {
            log(error);
            throw error;
          }
        }
      `)
    ).toEqual([]);
  });

  test("MUTATION: removing the savepoint from createOffice / restoreOffice / createPolicy / addIdentifierToProfile / grantPermissionToRole / assignRoleToGroup / setPrimaryTenantDomain turns the gate red", () => {
    const targets: Array<[string, string]> = [
      [
        "src/modules/tenant-admin/application/office-directory.ts",
        "createOffice"
      ],
      [
        "src/modules/tenant-admin/application/office-directory.ts",
        "restoreOffice"
      ],
      ["src/modules/identity-access/application/abac-admin.ts", "createPolicy"],
      [
        "src/modules/profile-identity/application/identifier-directory.ts",
        "addIdentifierToProfile"
      ],
      [
        "src/modules/identity-access/application/role-admin.ts",
        "grantPermissionToRole"
      ],
      [
        "src/modules/identity-access/application/user-admin.ts",
        "assignRoleToGroup"
      ],
      [
        "src/modules/tenant-domain/application/tenant-domain-directory.ts",
        "setPrimaryTenantDomain"
      ]
    ];

    for (const [file, scope] of targets) {
      const original = readFileSync(path.join(ROOT, file), "utf8");

      expect(findTransactionSwallows(file, original)).toEqual([]);

      // Only the FIRST savepoint inside THIS function is removed.
      const from = original.indexOf(`function ${scope}(`);
      const at = original.indexOf("tx.savepoint(", from);

      expect(from).toBeGreaterThan(-1);
      expect(at).toBeGreaterThan(from);

      const mutated =
        original.slice(0, at) +
        "((run) => run(tx))(" +
        original.slice(at + "tx.savepoint(".length);

      // The scope label is best-effort once the text is mutated; what matters
      // is that the gate is no longer green for this file (`scope` names the
      // function under test in the failure message).
      expect(
        findTransactionSwallows(file, mutated).length,
        `${file} ${scope}`
      ).toBeGreaterThan(0);
    }
  });
});

describe("transaction-swallow-check: the reviewed marker is strict (audit M2)", () => {
  const body = (catchBody: string) => `
    async function run(tx) {
      try {
        await tx\`SELECT 1\`;
      } catch (error) {
        ${catchBody}
      }
    }
  `;

  test("a real comment, first in THIS catch, with a substantive reason exempts", () => {
    expect(
      findings(
        body(`// tx-swallow-ok: raised on a healthy transaction by a read-only check
        return null;`)
      )
    ).toEqual([]);
  });

  test("a marker inside a string literal does not exempt", () => {
    expect(
      findings(
        body(`const note = "tx-swallow-ok: raised on a healthy transaction by a read-only check";
        return null;`)
      )
    ).toHaveLength(1);
  });

  test("a marker after the first statement does not exempt", () => {
    expect(
      findings(
        body(`log(error);
        // tx-swallow-ok: raised on a healthy transaction by a read-only check
        return null;`)
      )
    ).toHaveLength(1);
  });

  test("a marker inside a NESTED inner try/catch does not exempt the outer catch", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await tx\`SELECT 1\`;
          } catch (error) {
            try {
              log(error);
            } catch {
              // tx-swallow-ok: raised on a healthy transaction by a read-only check
            }
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a marker in the TRY body does not exempt the catch", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            // tx-swallow-ok: raised on a healthy transaction by a read-only check
            await tx\`SELECT 1\`;
          } catch {
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a short or category-free reason does not exempt", () => {
    expect(
      findings(body(`// tx-swallow-ok: fine\n return null;`))
    ).toHaveLength(1);
    expect(
      findings(
        body(
          `// tx-swallow-ok: trust me, this is perfectly fine here\n return null;`
        )
      )
    ).toHaveLength(1);
  });

  test("naming the error class is a substantive reason", () => {
    expect(
      findings(
        body(`// tx-swallow-ok: DatasetLifecycleError is raised by a lookup
        return null;`)
      )
    ).toEqual([]);
  });

  test("a comment or string that merely MENTIONS ROLLBACK TO SAVEPOINT does not exempt", () => {
    expect(
      findings(
        body(`// we should ROLLBACK TO SAVEPOINT here some day
        return null;`)
      )
    ).toHaveLength(1);
    expect(
      findings(body(`const doc = "ROLLBACK TO SAVEPOINT";\n return doc;`))
    ).toHaveLength(1);
  });

  test("an executed unsafe('ROLLBACK TO SAVEPOINT …') in the catch exempts", () => {
    expect(
      findings(
        body("await tx.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);\n return null;")
      )
    ).toEqual([]);
  });
});

describe("transaction-swallow-check: other promise-level swallows and handles (audit L2)", () => {
  test(".then(onFulfilled, onRejected) swallowing a tx statement", () => {
    const hits = findings(`
      async function run(tx) {
        await tx\`SELECT 1\`.then(() => 1, () => null);
      }
    `);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("promise_catch");
  });

  test(".then with a single handler is not a swallow", () => {
    expect(
      findings(`
        async function run(tx) {
          await tx\`SELECT 1\`.then((rows) => rows.length);
        }
      `)
    ).toEqual([]);
  });

  test("Promise.allSettled over tx statements", () => {
    const hits = findings(`
      async function run(tx) {
        await Promise.allSettled([tx\`SELECT 1\`, tx\`SELECT 2\`]);
      }
    `);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("promise_allsettled");
  });

  test("a parameter typed Bun.SQL under any name is a handle", () => {
    expect(
      findings(`
        async function run(conn: Bun.SQL) {
          try {
            await conn\`SELECT 1\`;
          } catch {
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });

  test("a FREE function named savepoint/begin does not hide a statement", () => {
    expect(
      findings(`
        async function run(tx) {
          try {
            await savepoint(tx, async () => { await tx\`SELECT 1\`; });
          } catch {
            return null;
          }
        }
      `)
    ).toHaveLength(1);
  });
});

describe("transaction-swallow-check: the scanner reads code, not prose", () => {
  test("try/catch and tx mentions inside comments, strings and templates are ignored", () => {
    expect(
      findings(`
        // try { await tx\`x\` } catch { return 1 }
        /* try { await tx\`x\` } catch { return 1 } */
        const doc = "try { await tx } catch { return null }";
        const sql = \`try { tx } catch { return }\`;
      `)
    ).toEqual([]);
  });

  test("sanitize keeps offsets and newlines", () => {
    const source = 'a // c\nb "s" `t${x}u`\n';
    const clean = sanitize(source);

    expect(clean).toHaveLength(source.length);
    expect(clean.split("\n")).toHaveLength(source.split("\n").length);
    expect(clean).toContain("x");
    expect(clean).not.toContain('s"');
  });
});

function walk(directory: string, out: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".astro")) {
      out.push(full);
    }
  }

  return out;
}

const ROOT = path.resolve(import.meta.dir, "..");

describe("transaction-swallow-check: the repository", () => {
  test("src/ has no unguarded catch-and-continue inside a transaction", () => {
    const offenders = walk(path.join(ROOT, "src"), []).flatMap((full) =>
      findTransactionSwallows(
        path.relative(ROOT, full).split(path.sep).join("/"),
        readFileSync(full, "utf8")
      )
    );

    expect(offenders.map((o) => `${o.file}:${o.line} [${o.scope}]`)).toEqual(
      []
    );
  });

  test("MUTATION: removing the savepoint from createAuthProvider turns the gate red", () => {
    const file =
      "src/modules/identity-access/application/auth-provider-directory.ts";
    const original = readFileSync(path.join(ROOT, file), "utf8");

    expect(findTransactionSwallows(file, original)).toEqual([]);

    // The pre-#1099 shape: the INSERT straight on `tx`, the 23505 caught.
    const mutated = original
      .replace(
        "rows = (await tx.savepoint(\n      (sp) => sp`",
        "rows = (await tx`"
      )
      .replace("`\n    )) as AuthProviderRow[];", "`) as AuthProviderRow[];");

    expect(mutated).not.toBe(original);

    const hits = findTransactionSwallows(file, mutated);

    expect(hits.map((hit) => hit.scope)).toEqual(["createAuthProvider"]);
  });

  test("MUTATION: removing the savepoint from the health signals turns the gate red", () => {
    const file = "src/modules/module-management/application/health-registry.ts";
    const original = readFileSync(path.join(ROOT, file), "utf8");

    expect(findTransactionSwallows(file, original)).toEqual([]);

    const mutated = original.replaceAll("tx.savepoint(", "((run) => run(tx))(");

    expect(findTransactionSwallows(file, mutated).length).toBeGreaterThan(0);
  });
});
