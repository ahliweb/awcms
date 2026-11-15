/**
 * Descriptor-declared extension points of `email` and `whatsapp_delivery`
 * (ADR-0164, Issue #1277).
 *
 * The behaviour that matters is cross-PROCESS: a derived e-mail category or a
 * WhatsApp template must be known to `email:dispatch` / `whatsapp:dispatch`
 * with no import of the module that owns it. Those tests run a FRESH bun
 * process that imports only the dispatcher's own code, which is the only way
 * to see a registry that a side-effect import would have populated.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  COMPOSITION_ROOTS,
  collectBaseWorkerAllowances,
  collectSeededWorkerCategories,
  findCompositionProblems,
  findGuardFunctionReissues,
  findManualRegistrations,
  findNarrowedWorkerCategories,
  findPriorGuardCategories,
  findSqlScanErrors,
  findWorkerCategoryProblems,
  isContinuationGap,
  scanSqlStatements
} from "../scripts/extension-points-check";
import {
  validateEmailCategoryDeclarations,
  validateWhatsappTemplateDeclarations
} from "../src/modules/_shared/extension-point-declarations";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { BASE_EMAIL_TEMPLATE_CATEGORIES } from "../src/modules/email/domain/email-template-categories";
import { listModules } from "../src/modules";
import { installExtensionPointSource } from "../src/modules/_shared/extension-point-source";
import { EMAIL_WORKER_GUARD_TRIGGERS } from "../scripts/security-readiness";
import { loadMigrations } from "../scripts/lib/migrations";
import { bookingModule } from "../src/modules/booking/module";
import { newsletterModule } from "../src/modules/newsletter/module";

const ROOT = new URL("..", import.meta.url).pathname;

/** The base worker allowances the real descriptors claim (hr_workforce, crm_follow_up). */
const BASE_WORKER_CATEGORY_ALLOWANCES =
  collectBaseWorkerAllowances(listModules());

// This test file is a composition root for the in-process tests below.
installExtensionPointSource(listModules);

function runFresh(script: string): string {
  const result = Bun.spawnSync(["bun", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: "" }
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }

  return result.stdout.toString().trim();
}

function loadMigrationText(prefix: string): string {
  const migration = loadMigrations().find((m) =>
    m.name.startsWith(`${prefix}_`)
  );

  if (!migration) {
    throw new Error(`no migration ${prefix}`);
  }

  return migration.sql;
}

function fixture(overrides: Partial<ModuleDescriptor>): ModuleDescriptor {
  return {
    ...newsletterModule,
    key: "fixture_mod",
    dependencies: ["email", "whatsapp_delivery"],
    emailTemplateCategories: undefined,
    whatsappTemplates: undefined,
    ...overrides
  } as ModuleDescriptor;
}

describe("the dispatcher processes load declarations with no import of the owner", () => {
  test("email:dispatch's own code knows a derived category declared by newsletter (the empty-code defect)", () => {
    const out = runFresh(`
      import "./scripts/email-dispatch";
      import { renderEmailTemplate } from "./src/modules/email/domain/email-template-render";
      const rendered = renderEmailTemplate(
        { subjectTemplate: { en: "s" }, textBodyTemplate: { en: "open {{confirmUrl}}" }, htmlBodyTemplate: null },
        { confirmUrl: "https://x.test/c?token=T", siteName: "S" },
        "derived.newsletter_confirmation"
      );
      console.log(rendered.textBody);
    `);

    expect(out).toBe("open https://x.test/c?token=T");
  });

  test("an undeclared derived category still renders no variable (fail-closed)", () => {
    const out = runFresh(`
      import "./scripts/email-dispatch";
      import { renderEmailTemplate } from "./src/modules/email/domain/email-template-render";
      const rendered = renderEmailTemplate(
        { subjectTemplate: { en: "s" }, textBodyTemplate: { en: "[{{confirmUrl}}]" }, htmlBodyTemplate: null },
        { confirmUrl: "https://x.test" },
        "derived.never_declared"
      );
      console.log(rendered.textBody);
    `);

    expect(out).toBe("[]");
  });

  test("a process that installed no source THROWS on a derived category and an unknown template, and still serves base ones", () => {
    const out = runFresh(`
      import { renderEmailTemplate, } from "./src/modules/email/domain/email-template-render";
      import { getWhatsappTemplate } from "./src/modules/whatsapp-delivery/domain/whatsapp-templates";
      import { getAllowedVariablesForCategory } from "./src/modules/email/domain/email-template-categories";
      const results = [];
      for (const f of [
        () => getAllowedVariablesForCategory("derived.newsletter_confirmation"),
        () => renderEmailTemplate({ subjectTemplate: { en: "s" }, textBodyTemplate: { en: "[{{x}}]" }, htmlBodyTemplate: null }, { x: "1" }, "derived.never_declared"),
        () => getWhatsappTemplate("booking.reminder")
      ]) {
        try { f(); results.push("ok"); } catch (e) { results.push(e.name); }
      }
      results.push(getAllowedVariablesForCategory("auth.password_reset") !== null ? "base" : "nobase");
      results.push(getWhatsappTemplate("system.notice") ? "builtin" : "nobuiltin");
      console.log(results.join(","));
    `);

    expect(out).toBe(
      "ExtensionPointSourceNotInstalledError,ExtensionPointSourceNotInstalledError,ExtensionPointSourceNotInstalledError,base,builtin"
    );
  });

  test("the registries import no module list and every composition root installs the source", () => {
    const files = [
      ...COMPOSITION_ROOTS,
      "src/modules/email/domain/email-template-categories.ts",
      "src/modules/whatsapp-delivery/domain/whatsapp-templates.ts"
    ].map((path) => ({ path, text: readFileSync(`${ROOT}${path}`, "utf8") }));

    expect(findCompositionProblems(files)).toEqual([]);
    expect(
      findCompositionProblems(
        files.map((file) =>
          file.path === "scripts/email-dispatch.ts"
            ? { ...file, text: "// installExtensionPointSource(listModules)" }
            : file.path.endsWith("whatsapp-templates.ts")
              ? {
                  ...file,
                  text: `import { listModules } from "../../index";\n${file.text}`
                }
              : file
        )
      )
    ).toHaveLength(2);
  });

  test("omnichannel-inbox:sla keeps the runner's WORKER_DATABASE_URL withholding (least privilege not regressed by the registries)", () => {
    const runner = readFileSync(`${ROOT}ops/run-job.sh`, "utf8");
    const block = runner.slice(
      runner.indexOf(
        "BEGIN GENERATED: app-role jobs that never open the worker connection"
      )
    );

    expect(
      block.slice(0, block.indexOf("WITHHOLD_WORKER_DATABASE_URL=1"))
    ).toContain("omnichannel-inbox:sla");
  });

  test("whatsapp:dispatch's own code resolves booking's templates without importing booking", () => {
    const out = runFresh(`
      import "./scripts/whatsapp-dispatch";
      import { getWhatsappTemplate } from "./src/modules/whatsapp-delivery/domain/whatsapp-templates";
      const t = getWhatsappTemplate("booking.reminder");
      console.log(t ? t.purpose + ":" + t.variables.join(",") : "unknown");
    `);

    expect(out).toBe("transactional:reservationNo,startsAt");
  });

  test("the two dispatcher entry scripts import no consumer module", () => {
    for (const script of [
      "scripts/email-dispatch.ts",
      "scripts/whatsapp-dispatch.ts"
    ]) {
      const text = readFileSync(`${ROOT}${script}`, "utf8");

      expect(text).not.toMatch(
        /from "\.\.\/src\/modules\/(booking|newsletter|crm-follow-up|hr-workforce)\//
      );
    }
  });

  test("in-repo declarations are what the gate expects", () => {
    expect(
      newsletterModule.emailTemplateCategories?.map((c) => c.category)
    ).toEqual(["derived.newsletter_confirmation"]);
    expect(bookingModule.whatsappTemplates?.map((t) => t.key).sort()).toEqual([
      "booking.confirmation",
      "booking.reminder"
    ]);
    expect(
      validateEmailCategoryDeclarations(
        listModules(),
        BASE_EMAIL_TEMPLATE_CATEGORIES
      )
    ).toEqual([]);
    expect(validateWhatsappTemplateDeclarations(listModules())).toEqual([]);
  });
});

describe("declaration validation", () => {
  const validate = (module: ModuleDescriptor) =>
    validateEmailCategoryDeclarations(
      [module],
      BASE_EMAIL_TEMPLATE_CATEGORIES
    ).map((issue) => issue.message);

  test("a category must be derived.*, snake case, not a base category", () => {
    expect(
      validate(
        fixture({
          emailTemplateCategories: [
            { category: "auth.password_reset", allowedVariables: [] },
            { category: "other.thing", allowedVariables: [] },
            { category: "derived.Bad-Name", allowedVariables: [] }
          ]
        })
      )
    ).toHaveLength(3);
  });

  test("a duplicate category across modules and a repeated variable are refused", () => {
    const a = fixture({
      key: "mod_a",
      emailTemplateCategories: [
        { category: "derived.dup", allowedVariables: ["x", "x"] }
      ]
    });
    const b = fixture({
      key: "mod_b",
      emailTemplateCategories: [
        { category: "derived.dup", allowedVariables: ["x"] }
      ]
    });
    const messages = validateEmailCategoryDeclarations(
      [a, b],
      BASE_EMAIL_TEMPLATE_CATEGORIES
    ).map((issue) => issue.message);

    expect(messages.some((m) => m.includes("also declared"))).toBe(true);
    expect(messages.some((m) => m.includes("twice"))).toBe(true);
  });

  test("a declaring module must depend on email", () => {
    expect(
      validate(
        fixture({
          dependencies: [],
          emailTemplateCategories: [
            { category: "derived.ok_one", allowedVariables: ["a"] }
          ]
        })
      )
    ).toEqual([
      'declares emailTemplateCategories but does not list "email" in dependencies.'
    ]);
  });

  test("a WhatsApp key must carry the owning module's prefix; a security template needs a secret", () => {
    const messages = validateWhatsappTemplateDeclarations([
      fixture({
        whatsappTemplates: [
          {
            key: "other.thing",
            version: 1,
            purpose: "transactional",
            body: "b",
            variables: []
          },
          {
            key: "fixture_mod.otp",
            version: 1,
            purpose: "security",
            body: "{{code}}",
            variables: ["code"]
          }
        ]
      })
    ]).map((issue) => issue.message);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('prefixed "fixture_mod."');
    expect(messages[1]).toContain("secret variable");
  });

  test("a soft capability edge is enough for WhatsApp, never for e-mail", () => {
    const soft = fixture({
      dependencies: [],
      capabilities: {
        consumes: [
          {
            capability: "whatsapp_delivery",
            providedBy: "whatsapp_delivery",
            optional: true
          }
        ]
      },
      whatsappTemplates: [
        {
          key: "fixture_mod.hello",
          version: 1,
          purpose: "transactional",
          body: "hi",
          variables: []
        }
      ]
    });

    expect(validateWhatsappTemplateDeclarations([soft])).toEqual([]);
  });
});

describe("the gate's probes go red when the protection is removed", () => {
  test("a hand registration outside the registries is flagged; the registries and comments are not", () => {
    expect(
      findManualRegistrations([
        {
          path: "src/modules/email/application/email-dispatch.ts",
          text: 'import "../../x/register";\nregisterDerivedEmailTemplateCategory("derived.a", []);'
        },
        {
          path: "scripts/whatsapp-dispatch.ts",
          text: "registerWhatsappTemplate({ key: 'a.b' });"
        },
        {
          path: "src/modules/whatsapp-delivery/domain/whatsapp-templates.ts",
          text: "registerWhatsappTemplate(x);"
        },
        {
          path: "src/modules/booking/module.ts",
          text: "// registerWhatsappTemplate(x) was removed"
        }
      ])
    ).toEqual([
      "scripts/whatsapp-dispatch.ts",
      "src/modules/email/application/email-dispatch.ts"
    ]);
  });

  test("a workerInsert category with no seeded row, and a seeded row nobody owns, are both flagged", () => {
    const owner = fixture({
      emailTemplateCategories: [
        {
          category: "derived.otp_mail",
          allowedVariables: ["code"],
          workerInsert: true
        }
      ]
    });
    const hr = new Set(Object.keys(BASE_WORKER_CATEGORY_ALLOWANCES));

    expect(
      findWorkerCategoryProblems(
        [owner],
        hr,
        BASE_WORKER_CATEGORY_ALLOWANCES
      ).filter((m) => m.includes("no migration seeds"))
    ).toHaveLength(1);
    expect(
      findWorkerCategoryProblems(
        [owner],
        new Set([...hr, "derived.otp_mail"]),
        BASE_WORKER_CATEGORY_ALLOWANCES
      )
    ).toEqual([]);
    expect(
      findWorkerCategoryProblems(
        [fixture({})],
        new Set([...hr, "derived.orphan"]),
        BASE_WORKER_CATEGORY_ALLOWANCES
      )
    ).toHaveLength(1);
  });

  test("a seeded BASE category that no worker job legitimately needs is flagged, and a stale allowance entry too", () => {
    const hr = Object.keys(BASE_WORKER_CATEGORY_ALLOWANCES);

    // `auth.password_reset` is a base category, and used to be waved through.
    const problems = findWorkerCategoryProblems(
      [fixture({})],
      new Set([...hr, "auth.password_reset"]),
      BASE_WORKER_CATEGORY_ALLOWANCES
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("base category no module claims");
    // An allowance entry no migration seeds is a stale reason.
    expect(
      findWorkerCategoryProblems(
        [fixture({})],
        new Set(hr.slice(1)),
        BASE_WORKER_CATEGORY_ALLOWANCES
      )
    ).toHaveLength(1);
    // And an allowance entry must name a base category.
    expect(
      findWorkerCategoryProblems([fixture({})], new Set([...hr, "derived.x"]), {
        ...BASE_WORKER_CATEGORY_ALLOWANCES,
        "derived.x": "not base"
      })
    ).toHaveLength(1);
  });

  test("seed rows are read from migration INSERTs and not from comments", () => {
    const { seeded, unparseable } = collectSeededWorkerCategories([
      {
        name: "410_awcms_x.sql",
        sql: `-- INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.commented');
/* INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.block'); */
INSERT INTO awcms_email_worker_categories (category) VALUES
  ('hr.a'), ('derived.b')
ON CONFLICT (category) DO NOTHING;`
      }
    ]);

    expect([...seeded].sort()).toEqual(["derived.b", "hr.a"]);
    expect(unparseable).toEqual([]);
  });

  test.each([
    [
      "schema-qualified",
      `INSERT INTO public.awcms_email_worker_categories (category) VALUES ('derived.q')`
    ],
    [
      "quoted identifiers",
      `INSERT INTO "public"."awcms_email_worker_categories" ("category") VALUES ('derived.q')`
    ],
    [
      "spaced qualification",
      `insert\n into  public .awcms_email_worker_categories(category)values('derived.q')`
    ],
    [
      "multi-row",
      `INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.q'),\n ('derived.r') ON CONFLICT DO NOTHING`
    ]
  ])("a %s INSERT is understood", (_name, sql) => {
    const { seeded, unparseable } = collectSeededWorkerCategories([
      { name: "411_awcms_y.sql", sql }
    ]);

    expect(unparseable).toEqual([]);
    expect(seeded.has("derived.q")).toBe(true);
  });

  test.each([
    [
      "INSERT ... SELECT",
      `INSERT INTO awcms_email_worker_categories (category) SELECT 'derived.q'`
    ],
    [
      "INSERT of an expression",
      `INSERT INTO public.awcms_email_worker_categories (category) VALUES ('derived.' || 'q')`
    ],
    [
      "INSERT without a column list",
      `INSERT INTO awcms_email_worker_categories VALUES ('derived.q')`
    ],
    [
      "DEFAULT VALUES",
      `INSERT INTO awcms_email_worker_categories DEFAULT VALUES`
    ],
    [
      "UPDATE",
      `UPDATE "awcms_email_worker_categories" SET category = 'derived.z'`
    ],
    ["DELETE", `DELETE FROM public.awcms_email_worker_categories`],
    ["TRUNCATE", `TRUNCATE awcms_email_worker_categories`],
    ["COPY", `COPY awcms_email_worker_categories FROM STDIN`],
    [
      "a DO block",
      `DO $$ BEGIN INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.q'); END $$`
    ],
    [
      "a function that writes it",
      `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.q') $$`
    ]
  ])("%s is reported, not silently skipped", (_name, sql) => {
    const { unparseable } = collectSeededWorkerCategories([
      { name: "411_awcms_y.sql", sql }
    ]);

    expect(unparseable).toHaveLength(1);
  });

  test("describing or reading the table is not a seed and is not reported", () => {
    const { seeded, unparseable } = collectSeededWorkerCategories([
      { name: "410_awcms_x.sql", sql: loadMigrationText("410") }
    ]);

    expect(unparseable).toEqual([]);
    expect([...seeded].sort()).toEqual(
      Object.keys(BASE_WORKER_CATEGORY_ALLOWANCES).sort()
    );
  });

  test.each([
    ["plain", "CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()"],
    ["no OR REPLACE", "CREATE FUNCTION awcms_email_guard_worker_insert()"],
    [
      "schema-qualified",
      "CREATE OR REPLACE FUNCTION public.awcms_email_guard_worker_insert()"
    ],
    [
      "quoted",
      `CREATE OR REPLACE FUNCTION "public"."awcms_email_guard_worker_insert"()`
    ],
    [
      "odd whitespace and case",
      "create\n  or\treplace   function\n public .AWCMS_EMAIL_GUARD_WORKER_INSERT ()"
    ],
    [
      "drop",
      "DROP FUNCTION IF EXISTS public.awcms_email_guard_worker_insert()"
    ],
    [
      "alter",
      "ALTER FUNCTION awcms_email_guard_worker_insert() SECURITY DEFINER"
    ],
    [
      "trigger re-create",
      "CREATE OR REPLACE TRIGGER awcms_email_messages_worker_guard BEFORE INSERT ON awcms_email_messages EXECUTE FUNCTION f()"
    ],
    [
      "trigger drop, qualified",
      `DROP TRIGGER awcms_email_messages_worker_guard ON public.awcms_email_messages`
    ]
  ])("a later migration touching the guard (%s) is flagged", (_name, sql) => {
    expect(
      findGuardFunctionReissues([
        { name: "302_awcms_a.sql", sql },
        { name: "410_awcms_b.sql", sql },
        { name: "411_awcms_c.sql", sql }
      ])
    ).toEqual(["411_awcms_c.sql"]);
  });

  test("a comment, a string and an unrelated migration are not a re-issue", () => {
    const create =
      "CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()";

    expect(
      findGuardFunctionReissues([
        {
          name: "412_awcms_d.sql",
          sql: `-- ${create}\n/* ${create} */\nSELECT 'awcms_email_guard_worker_insert';`
        },
        { name: "413_awcms_e.sql", sql: "CREATE TABLE t (id int);" }
      ])
    ).toEqual([]);
  });

  describe("the SQL reader follows the Postgres lexer", () => {
    const seedOf = (sql: string) =>
      collectSeededWorkerCategories([{ name: "411_awcms_z.sql", sql }]);
    const INSERT =
      "INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.real');";

    test.each([
      [
        "a dollar tag with a digit",
        `DO $fn1$ BEGIN PERFORM 1; END $fn1$; ${INSERT}`
      ],
      [
        "a tag-less dollar quote holding a semicolon",
        `SELECT $$ a; b $$; ${INSERT}`
      ],
      [
        "a dollar quote nested in another tag",
        `DO $outer$ BEGIN EXECUTE $inner$ SELECT ';' $inner$; END $outer$; ${INSERT}`
      ],
      [
        "an E string with an escaped quote",
        `SELECT E'it\\'s; here'; ${INSERT}`
      ],
      [
        "a standard string with a doubled quote",
        `SELECT 'it''s; here'; ${INSERT}`
      ],
      ["a quote inside a line comment", `-- don't\n${INSERT}`],
      ["a quote inside a block comment", `/* it's; */ ${INSERT}`],
      ["a nested block comment", `/* a /* b */ still; comment */ ${INSERT}`],
      [
        "a semicolon in a quoted identifier",
        `CREATE TABLE "a;b'c" (id int); ${INSERT}`
      ],
      [
        "an apostrophe inside a digit-tagged body",
        `SELECT $t1$ it's $t1$; ${INSERT}`
      ],
      ["a dollar parameter", `SELECT $1, $2; ${INSERT}`],
      ["a dollar inside an identifier", `SELECT a$b$ FROM t; ${INSERT}`]
    ])("%s does not desynchronise the reader", (_name, sql) => {
      const { seeded, unparseable } = seedOf(sql);

      expect(unparseable).toEqual([]);
      expect([...seeded]).toEqual(["derived.real"]);
      expect(scanSqlStatements(sql).error).toBeUndefined();
    });

    test("a re-issue after a digit-tag body is still found", () => {
      expect(
        findGuardFunctionReissues([
          {
            name: "411_awcms_c.sql",
            sql: `DO $fn1$ BEGIN NULL; END $fn1$;
CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $g2$ BEGIN RETURN NEW; END $g2$;`
          }
        ])
      ).toEqual(["411_awcms_c.sql"]);
    });

    test("a DO block or EXECUTE that re-creates the guard is flagged; a comment or grant is not", () => {
      const re = (sql: string) =>
        findGuardFunctionReissues([{ name: "411_awcms_c.sql", sql }]);

      expect(
        re(
          "DO $x1$ BEGIN CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $y$ BEGIN RETURN NEW; END $y$; END $x1$"
        )
      ).toEqual(["411_awcms_c.sql"]);
      expect(
        re("COMMENT ON FUNCTION awcms_email_guard_worker_insert() IS 'x'")
      ).toEqual([]);
    });

    test("a line comment ends at a bare carriage return", () => {
      const sql =
        "-- note\rINSERT INTO awcms_email_worker_categories (category) VALUES ('auth.password_reset');";
      const { seeded } = seedOf(sql);

      expect([...seeded]).toEqual(["auth.password_reset"]);
      expect(
        findGuardFunctionReissues([
          {
            name: "411_awcms_c.sql",
            sql: "-- x\rCREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;"
          }
        ])
      ).toEqual(["411_awcms_c.sql"]);
    });

    test("an E-string continuation keeps its backslash escapes", () => {
      const sql = `SELECT E'x'\n'\\'';\nCREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN RETURN NEW; END $g$;\n-- '`;

      expect(
        findGuardFunctionReissues([{ name: "411_awcms_c.sql", sql }])
      ).toEqual(["411_awcms_c.sql"]);
    });

    test.each([
      ["", true],
      [" \t\f\r\n", true],
      ["\n-- note", true],
      ["-- a -- b\n  ", true],
      ["--\r--", true],
      ["\nx", false],
      ["-\n", false],
      ["/* c */\n", false],
      ["-- a\nb", false]
    ])("the continuation gap %j is %p", (gap, expected) => {
      expect(isContinuationGap(gap)).toBe(expected);
    });

    test("a run of `--` before an E-string continuation is read in linear time (CodeQL js/redos)", () => {
      const run = "--".repeat(50_000);
      const sql = `SELECT E'a'${run}\nx'b'; ${INSERT}`;
      const started = performance.now();

      expect(isContinuationGap(`${run}\nx`)).toBe(false);
      expect(isContinuationGap(`${run}\n`)).toBe(true);
      expect(scanSqlStatements(sql).error).toBeUndefined();
      expect([...seedOf(sql).seeded]).toEqual(["derived.real"]);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    test("a Unicode-escaped identifier fails closed", () => {
      const sql = `CREATE OR REPLACE FUNCTION U&"awcms\\005femail_guard_worker_insert"() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN RETURN NEW; END $g$;`;

      expect(scanSqlStatements(sql).error).toBeDefined();
      expect(
        findGuardFunctionReissues([{ name: "411_awcms_c.sql", sql }])
      ).toEqual(["411_awcms_c.sql"]);
      expect(
        seedOf(
          `INSERT INTO U&"awcms\\005femail_worker_categories" (category) VALUES ('a.b');`
        ).unparseable
      ).toHaveLength(1);
    });

    test.each(["USER", "ALL"])(
      "ALTER TABLE awcms_email_messages DISABLE TRIGGER %s is flagged",
      (kind) => {
        expect(
          findGuardFunctionReissues([
            {
              name: "411_awcms_c.sql",
              sql: `ALTER TABLE public.awcms_email_messages DISABLE TRIGGER ${kind};`
            }
          ])
        ).toEqual(["411_awcms_c.sql"]);
      }
    );

    test("the pinned readiness trigger body is the body of sql/410", () => {
      const sql = readFileSync(
        `${ROOT}sql/410_awcms_email_worker_categories_allow_list.sql`,
        "utf8"
      );
      const body = /AS \$\$([\s\S]*?)\$\$;/.exec(sql)![1]!;
      const pin = EMAIL_WORKER_GUARD_TRIGGERS[0]!;

      expect(pin.body).toBe(body.replace(/\s+/g, " ").trim());
      expect(pin.events).toBe("insert");
    });

    test.each([
      ["an unterminated dollar quote", "SELECT $fn1$ never closed"],
      ["an unterminated string", "SELECT 'never closed"],
      ["an unterminated block comment", "SELECT 1 /* never closed"],
      ["an unterminated quoted identifier", 'SELECT "never closed']
    ])("%s fails closed when the migration names the guard", (_name, tail) => {
      const sql = `-- awcms_email_worker_categories\n${tail}`;

      expect(scanSqlStatements(sql).error).toBeDefined();
      expect(seedOf(sql).unparseable).toHaveLength(1);
      expect(
        findGuardFunctionReissues([{ name: "411_awcms_c.sql", sql }])
      ).toEqual(["411_awcms_c.sql"]);
      expect(
        findSqlScanErrors([{ name: "411_awcms_c.sql", sql }])
      ).toHaveLength(1);
    });

    test("an unrelated migration that cannot be tokenized is still reported by the scan-error sweep", () => {
      expect(
        findSqlScanErrors([{ name: "411_awcms_c.sql", sql: "SELECT 'open" }])
      ).toHaveLength(1);
      expect(findSqlScanErrors(loadMigrations())).toEqual([]);
    });
  });

  describe("the pre-410 guard allow-list is preserved (latest definition wins)", () => {
    test("the latest pre-410 body is sql/371's, not sql/302's, and covers six categories", () => {
      const prior = findPriorGuardCategories(loadMigrations());

      expect(prior.error).toBeUndefined();
      expect(prior.migration).toBe(
        "371_awcms_crm_follow_up_email_categories.sql"
      );
      expect([...prior.categories].sort()).toEqual(
        [
          "crm.follow_up_assigned",
          "crm.follow_up_due",
          "crm.follow_up_escalated",
          "hr.attendance_correction_applied",
          "hr.attendance_correction_cancelled",
          "hr.attendance_correction_rejected"
        ].sort()
      );
    });

    test("a seed narrower than the prior body is flagged per missing category", () => {
      const migrations = loadMigrations();
      const prior = findPriorGuardCategories(migrations);
      const seeded = collectSeededWorkerCategories(migrations).seeded;

      expect(findNarrowedWorkerCategories(prior, seeded)).toEqual([]);

      const narrowed = new Set(seeded);
      narrowed.delete("crm.follow_up_due");

      const problems = findNarrowedWorkerCategories(prior, narrowed);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("crm.follow_up_due");
    });

    test("a prior body the reader cannot read is an error, never an empty allow-list", () => {
      for (const sql of [
        "SELECT 1;",
        "CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",
        "CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.category NOT IN (lower('x')) THEN RETURN NULL; END IF; RETURN NEW; END $$;"
      ]) {
        const prior = findPriorGuardCategories([
          { name: "302_awcms_a.sql", sql }
        ]);

        expect(prior.error).toBeDefined();
        expect(findNarrowedWorkerCategories(prior, new Set())).not.toEqual([]);
      }
    });

    test("a later CREATE of the guard before 410 supersedes an earlier one", () => {
      const def = (list: string) =>
        `CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.category NOT IN (${list}) THEN RETURN NULL; END IF; RETURN NEW; END $$;`;
      const prior = findPriorGuardCategories([
        { name: "302_awcms_a.sql", sql: def("'a.one'") },
        { name: "371_awcms_b.sql", sql: def("'a.one', 'b.two'") },
        { name: "420_awcms_c.sql", sql: def("'z.late'") }
      ]);

      expect([...prior.categories].sort()).toEqual(["a.one", "b.two"]);
    });

    test("sql/410 seeds a superset of every category the prior guard allowed", () => {
      const prior = findPriorGuardCategories(loadMigrations());
      const seeded = collectSeededWorkerCategories([
        { name: "410_awcms_x.sql", sql: loadMigrationText("410") }
      ]).seeded;

      for (const category of prior.categories) {
        expect(seeded.has(category)).toBe(true);
      }
    });
  });

  test("each base worker row is claimed by a module descriptor, and an unclaimed claim or duplicate is flagged", () => {
    expect(Object.keys(BASE_WORKER_CATEGORY_ALLOWANCES).sort()).toEqual([
      "crm.follow_up_assigned",
      "crm.follow_up_due",
      "crm.follow_up_escalated",
      "hr.attendance_correction_applied",
      "hr.attendance_correction_cancelled",
      "hr.attendance_correction_rejected"
    ]);

    const claim = (key: string, category: string, reason = "because") =>
      fixture({
        key,
        workerEmailCategories: [{ category, reason }]
      });
    const seeded = new Set(Object.keys(BASE_WORKER_CATEGORY_ALLOWANCES));

    expect(
      findWorkerCategoryProblems(
        [
          claim("m_a", "hr.attendance_correction_applied"),
          claim("m_b", "hr.attendance_correction_applied")
        ],
        new Set(["hr.attendance_correction_applied"])
      ).some((m) => m.includes("both claim"))
    ).toBe(true);
    expect(
      findWorkerCategoryProblems(
        [claim("m_a", "crm.follow_up_due", "  ")],
        new Set(["crm.follow_up_due"])
      ).some((m) => m.includes("without a reason"))
    ).toBe(true);
    // Dropping the descriptor claim leaves the seeded row unowned.
    expect(
      findWorkerCategoryProblems(
        listModules().filter((m) => m.key !== "crm_follow_up"),
        seeded
      ).filter((m) => m.includes("no module claims"))
    ).toHaveLength(3);
  });

  test("the real repository passes every probe", () => {
    // Guards the gate against rotting into one that checks nothing: the real
    // migrations seed the three hr categories and re-issue nothing.
    const migrations = loadMigrations();

    const { seeded, unparseable } = collectSeededWorkerCategories(migrations);

    expect(seeded.size).toBeGreaterThanOrEqual(3);
    expect(unparseable).toEqual([]);
    expect(findGuardFunctionReissues(migrations)).toEqual([]);
    expect(findWorkerCategoryProblems(listModules(), seeded)).toEqual([]);
    expect(
      findNarrowedWorkerCategories(findPriorGuardCategories(migrations), seeded)
    ).toEqual([]);
  });
});
