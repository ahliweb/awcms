/**
 * `modules:table-writes:check` — ADR-0013 §6, "no shared-table write".
 *
 * ## Injecting the violation, not just asserting green
 *
 * Every case below feeds `findSharedTableWrites` input it must reject, and the
 * central one reinstates the REAL defect this gate was written for rather than
 * an invented one: `identity_access` writing `awcms_profiles`, which is what
 * two separate files did (JIT provisioning #185 and self-registration approval
 * #276) until they were routed through `profile_identity`. A gate that has only
 * ever been observed passing has not been observed at all.
 *
 * The last test runs the gate against the real repository, so this file is also
 * the drift detector: a new hand-written INSERT into another module's table
 * fails here on the PR that introduces it.
 */
import { describe, expect, test } from "bun:test";

import {
  DOCUMENTED_EXCEPTIONS,
  collectTableWrites,
  findSharedTableWrites,
  ownerOfFile,
  stripComments
} from "../scripts/table-write-ownership-check";
import { collectClaims } from "../scripts/validate-module-routes";
import { listModules } from "../src/modules";

describe("findSharedTableWrites", () => {
  test("flags the defect this gate exists for: identity_access writing awcms_profiles", () => {
    const shared = findSharedTableWrites([
      {
        table: "awcms_profiles",
        owner: "profile_identity",
        file: "src/modules/profile-identity/application/party-directory.ts"
      },
      {
        table: "awcms_profiles",
        owner: "identity_access",
        file: "src/modules/identity-access/application/self-registration.ts"
      }
    ]);

    expect(shared).toHaveLength(1);
    expect(shared[0]!.table).toBe("awcms_profiles");
    expect(shared[0]!.owners).toEqual(["identity_access", "profile_identity"]);
    // The report has to name the file, or an operator learns only that
    // something somewhere is wrong.
    expect(shared[0]!.writers.map((writer) => writer.file)).toContain(
      "src/modules/identity-access/application/self-registration.ts"
    );
  });

  test("does not flag many writes from a single owner", () => {
    expect(
      findSharedTableWrites([
        { table: "awcms_blog_posts", owner: "blog_content", file: "a.ts" },
        { table: "awcms_blog_posts", owner: "blog_content", file: "b.ts" },
        { table: "awcms_blog_posts", owner: "blog_content", file: "c.ts" }
      ])
    ).toEqual([]);
  });

  test("does not flag the reviewed bootstrap exception", () => {
    expect(
      findSharedTableWrites([
        { table: "awcms_roles", owner: "identity_access", file: "a.ts" },
        { table: "awcms_roles", owner: "tenant_admin", file: "b.ts" }
      ])
    ).toEqual([]);
  });

  test("an exception covers only its own table", () => {
    // `awcms_sessions` is not in the list, so the same pair of owners on a
    // different table is still a finding — an exception must not read as a
    // blanket licence between two modules.
    const shared = findSharedTableWrites([
      { table: "awcms_sessions", owner: "identity_access", file: "a.ts" },
      { table: "awcms_sessions", owner: "tenant_admin", file: "b.ts" }
    ]);

    expect(shared).toHaveLength(1);
    expect(shared[0]!.table).toBe("awcms_sessions");
  });

  test("an exception does not cover an owner it never named", () => {
    // Bootstrap excuses three modules. A FOURTH writer appearing on the same
    // table is new coupling wearing the exception's clothes.
    const shared = findSharedTableWrites([
      { table: "awcms_identities", owner: "tenant_admin", file: "a.ts" },
      { table: "awcms_identities", owner: "identity_access", file: "b.ts" },
      { table: "awcms_identities", owner: "site_search", file: "c.ts" }
    ]);

    expect(shared).toHaveLength(1);
    expect(shared[0]!.owners).toContain("site_search");
  });

  test("every exception carries a reason a reviewer can disagree with", () => {
    for (const entry of DOCUMENTED_EXCEPTIONS) {
      expect(entry.excusedOwner.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(80);
    }
  });

  test("an exception forgives ONE writer, it does not open the table to a group", () => {
    // The first version of the exception list named every owner allowed to
    // touch the table. On `awcms_profiles` that meant naming `identity_access`
    // alongside `tenant_admin` and `profile_identity` — which silently
    // re-permitted the exact write this change removed. The first test in this
    // file failed on it, which is why the shape is `excusedOwner` now.
    // Issue #1160 audit M3 adds ONE more forgiven writer: the rolled-back
    // behavioural probe in `scripts/lib/worker-secret-probe.ts`, on exactly the four tables
    // it seeds. Each entry still names a single writer.
    const PROBE_TABLES = [
      "awcms_tenants",
      "awcms_channel_accounts",
      "awcms_channel_provider_connections",
      "awcms_channel_secrets",
      "awcms_channel_account_capabilities",
      "awcms_telegram_engagement_endpoints",
      "awcms_telegram_engagement_contacts",
      // #1268: the telegram probe's refused forged-opt-in attempt.
      "awcms_telegram_engagement_consents",
      // #1161 M-3 of the PR #1272 audit: the rolled-back retention-floor probe;
      // #1143: the worker purge-floor probe (subscriptions seeded by both).
      "awcms_channel_webhook_subscriptions",
      "awcms_email_provider_events",
      "awcms_whatsapp_service_windows",
      "awcms_whatsapp_webhook_receipts",
      // #1298 LOW-1: the same probe seeds queue rows for the DELETE floor.
      "awcms_whatsapp_messages",
      // #1146: the social dispatch write-boundary probe.
      "awcms_social_publications",
      "awcms_social_publish_jobs",
      "awcms_channel_account_health",
      "awcms_audit_events",
      "awcms_domain_events",
      "awcms_domain_event_deliveries",
      // #1145 L8 (sql/386): the social source re-check probe.
      "awcms_blog_posts",
      "awcms_news_media_objects"
    ];

    for (const entry of DOCUMENTED_EXCEPTIONS) {
      // Tooling exceptions: the rolled-back behavioural probes (#1145 M-1 in
      // `scripts/security-readiness.ts`, #1160 M3 in `scripts/lib/worker-secret-probe.ts`,
      // #1156 M-A/M-B in `scripts/lib/telegram-engagement-dispatch-probe.ts`).
      // Each forgives only the tooling writer, only on the tables it seeds, and
      // only with a reason that says the transaction always rolls back.
      if (entry.excusedOwner === "(scripts tooling)") {
        expect(PROBE_TABLES).toContain(entry.table);
        expect(entry.reason).toMatch(/always rolls/i);
        continue;
      }

      expect(entry.excusedOwner).toBe("tenant_admin");
    }
  });
});

describe("scripts/** is scanned (Issue #1268)", () => {
  const TOOLING = "(scripts tooling)";

  test("a file under scripts/lib is attributed to tooling, not to nobody", () => {
    expect(ownerOfFile("scripts/lib/some-probe.ts", new Map(), [])).toBe(
      TOOLING
    );
  });

  test("a planted scripts/lib write to a module-owned table is a finding", () => {
    const shared = findSharedTableWrites([
      {
        table: "awcms_planted_probe_table",
        owner: "some_module",
        file: "src/modules/some-module/application/x.ts"
      },
      {
        table: "awcms_planted_probe_table",
        owner: TOOLING,
        file: "scripts/lib/planted-probe.ts"
      }
    ]);

    expect(shared).toHaveLength(1);
    expect(shared[0]!.owners).toContain(TOOLING);
  });

  test("every real tooling write has a documented exception, and every tooling exception matches a real write", async () => {
    const writes = await collectTableWrites();
    const written = new Set(
      writes
        .filter((write) => write.owner === TOOLING)
        .map((write) => write.table)
    );
    const excused = new Set(
      DOCUMENTED_EXCEPTIONS.filter(
        (entry) => entry.excusedOwner === TOOLING
      ).map((entry) => entry.table)
    );

    // The glob must really reach scripts/lib: the probes live there.
    expect(
      writes.some(
        (write) =>
          write.file === "scripts/lib/worker-secret-probe.ts" &&
          write.owner === TOOLING
      )
    ).toBe(true);

    // A tooling write with no exception: a second writer added under scripts/
    // (also catches a table nobody else writes, which the one-writer rule
    // alone would not flag).
    // Tooling-only tables: no module writes them, so tooling is their owner
    // rather than a second writer. Anything else added here needs the same
    // argument.
    // - `awcms_schema_migrations`: the migration runner's ledger.
    // - `awcms_pgbouncer_verify` (#1286): a scratch table that
    //   `scripts/database-pgbouncer-verify.ts` creates, writes and drops
    //   itself; no migration defines it and no module can see it.
    const TOOLING_OWNED = new Set([
      "awcms_schema_migrations",
      "awcms_pgbouncer_verify"
    ]);

    for (const table of TOOLING_OWNED) {
      expect(
        writes.filter(
          (write) => write.table === table && write.owner !== TOOLING
        )
      ).toEqual([]);
    }

    expect(
      [...written].filter(
        (table) => !excused.has(table) && !TOOLING_OWNED.has(table)
      )
    ).toEqual([]);

    // An exception nothing uses is a paper exception: it would silently
    // excuse a future writer of that table.
    expect([...excused].filter((table) => !written.has(table))).toEqual([]);
  });
});

describe("attribution", () => {
  const directoryToKey = new Map([
    ["identity-access", "identity_access"],
    ["workflow-approval", "workflow"]
  ]);
  const { claims } = collectClaims(listModules());

  test("a module directory resolves through its DESCRIPTOR key, not its name", () => {
    // `src/modules/workflow-approval/` declares `key: "workflow"`. A directory
    // name transformed with `replaceAll("-", "_")` produces a key absent from
    // the registry, and every edge out of it silently resolves to nothing.
    expect(
      ownerOfFile("src/modules/workflow-approval/x.ts", directoryToKey, claims)
    ).toBe("workflow");
  });

  test("a route resolves to the module that claims it, not to nobody", () => {
    // `INSERT INTO awcms_sessions` lives in `src/pages/api/v1/auth/login.ts`.
    // Without route attribution it would read as a second, nameless writer of
    // a table `identity_access` already owns — a false positive on every
    // module that puts SQL in its own route.
    expect(
      ownerOfFile("src/pages/api/v1/auth/login.ts", directoryToKey, claims)
    ).toBe("identity_access");
  });

  test("src/lib is infrastructure and is named as such", () => {
    expect(
      ownerOfFile("src/lib/edge-cache/purge-queue.ts", directoryToKey, claims)
    ).toContain("infrastructure");
  });
});

describe("stripComments", () => {
  test("a file that DOCUMENTS a write is not counted as making one", () => {
    // This is not hypothetical: before it was added, the gate reported itself
    // and `person-profile.ts` as writers of `awcms_profiles`, purely from the
    // prose explaining the rule.
    const source = [
      "/**",
      " * Historically this did `INSERT INTO awcms_profiles` directly.",
      " */",
      "// also see: INSERT INTO awcms_identities",
      "await tx`INSERT INTO awcms_registration_requests (x) VALUES (1)`;"
    ].join("\n");

    const stripped = stripComments(source);

    expect(stripped).not.toContain("awcms_profiles");
    expect(stripped).not.toContain("awcms_identities");
    expect(stripped).toContain("awcms_registration_requests");
  });

  test("keeps a code line that merely contains a URL", () => {
    // Stripping trailing `//` would truncate here and lose the statement —
    // trading a false positive for a false negative, which is the worse trade.
    const line =
      'const u = "https://x/y"; await tx`DELETE FROM awcms_sessions`;';

    expect(stripComments(line)).toContain("awcms_sessions");
  });
});

describe("the real repository", () => {
  test("has exactly one writer per table", async () => {
    const shared = findSharedTableWrites(await collectTableWrites());

    expect(
      shared.map((entry) => `${entry.table}: ${entry.owners.join(" + ")}`)
    ).toEqual([]);
  }, 60000);

  test("identity_access no longer writes profile_identity's table", async () => {
    // The specific regression. `awcms_identities.profile_id` is NOT NULL, so
    // creating an identity structurally needs a profile — which is exactly why
    // the shortcut kept being taken, and why it is worth pinning.
    const writes = await collectTableWrites();
    const owners = writes
      .filter((write) => write.table === "awcms_profiles")
      .map((write) => write.owner);

    expect([...new Set(owners)].sort()).toEqual([
      "profile_identity",
      "tenant_admin"
    ]);
  }, 60000);

  test("is wired into `bun run check`", async () => {
    const manifest = (await Bun.file("package.json").json()) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["modules:table-writes:check"]).toBeDefined();
    // A gate nobody runs is documentation with a shebang.
    expect(manifest.scripts.check).toContain("modules:table-writes:check");
  });
});
