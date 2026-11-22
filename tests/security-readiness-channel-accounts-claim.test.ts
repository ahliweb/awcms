/**
 * `security:readiness` pins and probes the external-account claim (sql/416,
 * Issue #1215, ADR-0170). Proven both ways against a migrated database: the pins
 * and the behavioural probe are clean on the real schema, and each deliberate
 * widening (the global index back to every live row, or to a pending row; a
 * dropped per-tenant index; an open default basis; a locator with an extra
 * column, a public EXECUTE or a hollowed-out body) turns at least one of them
 * red; the schema is restored after every mutation.
 *
 * Gated on `DATABASE_URL` (a database migrated through sql/416, connected as a
 * role that may seed a throwaway tenant so the probe runs).
 */
import { describe, expect, test } from "bun:test";

import {
  pinChannelAccountsClaimGuards,
  probeChannelAccountsClaimGuards
} from "../scripts/lib/channel-accounts-claim-guards";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const REVIEWED_GLOBAL = `CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key
  ON awcms_channel_accounts (provider, external_id)
  WHERE deleted_at IS NULL
    AND (claim_basis = 'registration' OR status IN ('connected', 'degraded'))`;

describeOrSkip("security:readiness — channel account claim guards", () => {
  async function withAdmin<T>(work: (sql: Bun.SQL) => Promise<T>): Promise<T> {
    const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });

    try {
      return await work(sql);
    } finally {
      await sql.close({ timeout: 1 });
    }
  }

  /** Applies `mutate`, collects the findings, and ALWAYS restores. */
  async function mutated(
    mutate: (sql: Bun.SQL) => Promise<void>,
    restore: (sql: Bun.SQL) => Promise<void>
  ): Promise<{ pins: string[]; probe: string[] }> {
    return withAdmin(async (sql) => {
      try {
        await mutate(sql);

        const probe = await probeChannelAccountsClaimGuards(sql);

        expect(probe).not.toBeNull();

        return {
          pins: await pinChannelAccountsClaimGuards(sql),
          probe: probe ?? []
        };
      } finally {
        await restore(sql);
      }
    });
  }

  const restoreGlobalIndex = async (sql: Bun.SQL) => {
    await sql`DROP INDEX IF EXISTS awcms_channel_accounts_live_external_key`;
    await sql.unsafe(REVIEWED_GLOBAL);
  };

  test("is clean on the real schema", async () => {
    await withAdmin(async (sql) => {
      const probe = await probeChannelAccountsClaimGuards(sql);

      expect(probe).not.toBeNull();
      expect(await pinChannelAccountsClaimGuards(sql)).toEqual([]);
      expect(probe).toEqual([]);
    });
  });

  test("the global index back to every live row (the pre-ADR-0170 shape) is a finding of both halves", async () => {
    const result = await mutated(async (sql) => {
      await sql`DROP INDEX awcms_channel_accounts_live_external_key`;
      await sql`CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key
          ON awcms_channel_accounts (provider, external_id) WHERE deleted_at IS NULL`;
    }, restoreGlobalIndex);

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_live_external_key differs"
    );
    expect(result.probe.join(" ")).toContain("only pending");
  });

  test("a global index that also holds on pending rows is a finding of both halves", async () => {
    const result = await mutated(async (sql) => {
      await sql`DROP INDEX awcms_channel_accounts_live_external_key`;
      await sql`CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key
          ON awcms_channel_accounts (provider, external_id)
          WHERE deleted_at IS NULL
            AND (claim_basis = 'registration'
                 OR status IN ('pending', 'connected', 'degraded'))`;
    }, restoreGlobalIndex);

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_live_external_key differs"
    );
    expect(result.probe.join(" ")).toContain("only pending");
  });

  test("a global index that holds only verified rows (registration claims released) is a finding of both halves", async () => {
    const result = await mutated(async (sql) => {
      await sql`DROP INDEX awcms_channel_accounts_live_external_key`;
      await sql`CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key
          ON awcms_channel_accounts (provider, external_id)
          WHERE deleted_at IS NULL AND status IN ('connected', 'degraded')`;
    }, restoreGlobalIndex);

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_live_external_key differs"
    );
    expect(result.probe.join(" ")).toContain("registration-basis row holds");
  });

  test("a dropped per-tenant index is a finding of both halves", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`DROP INDEX awcms_channel_accounts_tenant_external_key`;
      },
      async (sql) => {
        await sql`CREATE UNIQUE INDEX awcms_channel_accounts_tenant_external_key
          ON awcms_channel_accounts (tenant_id, provider, external_id)
          WHERE deleted_at IS NULL`;
      }
    );

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_tenant_external_key is missing"
    );
    expect(result.probe.join(" ")).toContain(
      "registering the same live id twice"
    );
  });

  test("an open default basis is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ALTER COLUMN claim_basis SET DEFAULT 'verification'`;
      },
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ALTER COLUMN claim_basis SET DEFAULT 'registration'`;
      }
    );

    expect(result.pins.join(" ")).toContain(
      "not the fail-closed 'registration'"
    );
  });

  test("a dropped basis CHECK is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts DROP CONSTRAINT awcms_channel_accounts_claim_basis_check`;
      },
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ADD CONSTRAINT awcms_channel_accounts_claim_basis_check CHECK (claim_basis IN ('registration', 'verification'))`;
      }
    );

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_claim_basis_check"
    );
  });

  test("a locator that can read another column is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`GRANT SELECT (display_name) ON awcms_channel_accounts TO awcms_channel_claim_locator`;
      },
      async (sql) => {
        await sql`REVOKE SELECT (display_name) ON awcms_channel_accounts FROM awcms_channel_claim_locator`;
      }
    );

    expect(result.pins.join(" ")).toContain("not exactly the reviewed columns");
  });

  test("a locator that can write is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`GRANT UPDATE (status) ON awcms_channel_accounts TO awcms_channel_claim_locator`;
      },
      async (sql) => {
        await sql`REVOKE UPDATE (status) ON awcms_channel_accounts FROM awcms_channel_claim_locator`;
      }
    );

    expect(result.pins.join(" ")).toContain("write or REFERENCES");
  });

  test("a locator with a privilege on another table is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`GRANT SELECT ON awcms_channel_secrets TO awcms_channel_claim_locator`;
      },
      async (sql) => {
        await sql`REVOKE SELECT ON awcms_channel_secrets FROM awcms_channel_claim_locator`;
      }
    );

    expect(result.pins.join(" ")).toContain("awcms_channel_secrets");
  });

  test("EXECUTE for PUBLIC is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`GRANT EXECUTE ON FUNCTION awcms_find_channel_account_claim_holder(text, text) TO PUBLIC`;
      },
      async (sql) => {
        await sql`REVOKE EXECUTE ON FUNCTION awcms_find_channel_account_claim_holder(text, text) FROM PUBLIC`;
      }
    );

    expect(result.pins.join(" ")).toContain("EXECUTE is held by");
  });

  test("a locator that answers a pending verification-basis row, or matches loosely, is caught by the body pin and the probe", async () => {
    let original = "";
    const result = await mutated(
      async (sql) => {
        original = (
          (await sql`
            SELECT pg_get_functiondef(to_regprocedure('awcms_find_channel_account_claim_holder(text,text)')) AS def
          `) as { def: string }[]
        )[0]!.def;
        await sql.unsafe(
          original.replace(
            "AND (a.claim_basis = 'registration' OR a.status IN ('connected', 'degraded'))",
            ""
          )
        );
      },
      async (sql) => {
        if (original) await sql.unsafe(original);
      }
    );

    expect(original).toContain("a.claim_basis = 'registration'");
    expect(result.pins.join(" ")).toContain("its body is no longer");
    expect(result.probe.join(" ")).toContain("holding a claim");
  });

  test("the schema is whole again after the mutations", async () => {
    await withAdmin(async (sql) => {
      expect(await pinChannelAccountsClaimGuards(sql)).toEqual([]);
      expect(await probeChannelAccountsClaimGuards(sql)).toEqual([]);
    });
  });
});
