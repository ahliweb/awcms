/**
 * `security:readiness` pins and probes the channel-account access guards
 * (sql/398 and sql/399, Issue #1215 M-c). Proven both ways against a migrated
 * database: the pins and the behavioural probe are clean on the real schema,
 * and each deliberate widening (an open default, a dropped CHECK, a disabled or
 * hollowed-out guard) turns at least one of them red; the schema is restored
 * after every mutation.
 *
 * Gated on `DATABASE_URL` (a database migrated through sql/399, connected as a
 * role that may seed a throwaway tenant so the probe runs).
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  CHANNEL_ACCOUNTS_ACCESS_GUARDS,
  pinChannelAccountsAccessGuards,
  probeChannelAccountsAccessGuards
} from "../scripts/lib/channel-accounts-access-guards";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describe("channel account access guard pins match the migrations", () => {
  test("each pinned body is the body its migration ships", () => {
    const source =
      readFileSync("sql/398_awcms_channel_accounts_access_mode.sql", "utf8") +
      readFileSync(
        "sql/399_awcms_channel_accounts_last_owner_guard.sql",
        "utf8"
      );
    const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

    for (const pin of CHANNEL_ACCOUNTS_ACCESS_GUARDS) {
      expect(squash(source)).toContain(squash(pin.body));
    }
  });
});

describeOrSkip("security:readiness — channel account access guards", () => {
  async function withAdmin<T>(work: (sql: Bun.SQL) => Promise<T>): Promise<T> {
    const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });

    try {
      return await work(sql);
    } finally {
      await sql.close({ timeout: 1 });
    }
  }

  /** Pins plus probe; `null` probe would mean it was skipped, which is itself a failure here. */
  async function findings(sql: Bun.SQL): Promise<string[]> {
    const probe = await probeChannelAccountsAccessGuards(sql);

    expect(probe).not.toBeNull();

    return [...(await pinChannelAccountsAccessGuards(sql)), ...(probe ?? [])];
  }

  /** Applies `mutate`, collects the findings, and ALWAYS restores. */
  async function mutated(
    mutate: (sql: Bun.SQL) => Promise<void>,
    restore: (sql: Bun.SQL) => Promise<void>
  ): Promise<{ pins: string[]; probe: string[] }> {
    return withAdmin(async (sql) => {
      try {
        await mutate(sql);

        return {
          pins: await pinChannelAccountsAccessGuards(sql),
          probe: (await probeChannelAccountsAccessGuards(sql)) ?? []
        };
      } finally {
        await restore(sql);
      }
    });
  }

  test("is clean on the real schema", async () => {
    await withAdmin(async (sql) => {
      expect(await findings(sql)).toEqual([]);
    });
  });

  test("an open default is a finding of both halves", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ALTER COLUMN access_mode SET DEFAULT 'tenant_wide'`;
      },
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ALTER COLUMN access_mode SET DEFAULT 'assigned'`;
      }
    );

    expect(result.pins.join(" ")).toContain("not the closed mode");
    expect(result.probe.join(" ")).toContain("the default is open");
  });

  test("a dropped CHECK is a finding", async () => {
    const result = await mutated(
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts DROP CONSTRAINT awcms_channel_accounts_access_mode_check`;
      },
      async (sql) => {
        await sql`ALTER TABLE awcms_channel_accounts ADD CONSTRAINT awcms_channel_accounts_access_mode_check CHECK (access_mode IN ('assigned', 'tenant_wide'))`;
      }
    );

    expect(result.pins.join(" ")).toContain(
      "awcms_channel_accounts_access_mode_check"
    );
    expect(result.probe.join(" ")).toContain("outside the two reviewed values");
  });

  for (const pin of CHANNEL_ACCOUNTS_ACCESS_GUARDS) {
    test(`disabling ${pin.trigger} turns the pins red, and the probe too except where the trigger only reports`, async () => {
      const result = await mutated(
        async (sql) => {
          await sql.unsafe(
            `ALTER TABLE ${pin.table} DISABLE TRIGGER ${pin.trigger}`
          );
        },
        async (sql) => {
          await sql.unsafe(
            `ALTER TABLE ${pin.table} ENABLE TRIGGER ${pin.trigger}`
          );
        }
      );

      expect(result.pins.join(" ")).toContain(pin.trigger);
      // Every guard has an observable behaviour, so the probe notices as well.
      expect(result.probe.length).toBeGreaterThan(0);
    });

    test(`hollowing out ${pin.fn} (same name, same trigger, no logic) is caught by the body pin and by the probe`, async () => {
      let original = "";
      const result = await mutated(
        async (sql) => {
          const rows = (await sql`
            SELECT pg_get_functiondef(to_regproc(${pin.fn})) AS def
          `) as { def: string }[];

          original = rows[0]!.def;
          await sql.unsafe(`
            CREATE OR REPLACE FUNCTION ${pin.fn}() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp
            AS $f$ BEGIN RETURN ${pin.tgtype & 8 ? "OLD" : "NEW"}; END; $f$
          `);
        },
        async (sql) => {
          if (original) await sql.unsafe(original);
        }
      );

      expect(result.pins.join(" ")).toContain(pin.trigger);
      expect(result.probe.length).toBeGreaterThan(0);
    });
  }

  test("a widened guard that still names its message passes a substring pin but not these", async () => {
    // The shape a `LIKE '%last owner%'` pin would accept: the sentence is still
    // in the body, but the condition that raises it can never be true.
    let original = "";
    const result = await mutated(
      async (sql) => {
        original = (
          (await sql`
            SELECT pg_get_functiondef(to_regproc('awcms_channel_account_assignments_guard')) AS def
          `) as { def: string }[]
        )[0]!.def;
        await sql.unsafe(
          original.replace("IF v_mode = 'assigned' THEN", "IF false THEN")
        );
      },
      async (sql) => {
        if (original) await sql.unsafe(original);
      }
    );

    expect(original).toContain("last owner of an assigned channel account");
    expect(result.pins.join(" ")).toContain(
      "awcms_channel_account_assignments_guard"
    );
    expect(result.probe.join(" ")).toContain("demoting the last owner");
  });

  test("the schema is whole again after the mutations", async () => {
    await withAdmin(async (sql) => {
      expect(await findings(sql)).toEqual([]);
    });
  });
});
