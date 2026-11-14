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
  collectSeededWorkerCategories,
  findGuardFunctionReissues,
  findManualRegistrations,
  findWorkerCategoryProblems
} from "../scripts/extension-points-check";
import {
  validateEmailCategoryDeclarations,
  validateWhatsappTemplateDeclarations
} from "../src/modules/_shared/extension-point-declarations";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { BASE_EMAIL_TEMPLATE_CATEGORIES } from "../src/modules/email/domain/email-template-categories";
import { listModules } from "../src/modules";
import { loadMigrations } from "../scripts/lib/migrations";
import { bookingModule } from "../src/modules/booking/module";
import { newsletterModule } from "../src/modules/newsletter/module";

const ROOT = new URL("..", import.meta.url).pathname;

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
      import "./src/modules/email/application/email-dispatch";
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

  test("whatsapp:dispatch's own code resolves booking's templates without importing booking", () => {
    const out = runFresh(`
      import "./src/modules/whatsapp-delivery/application/whatsapp-dispatch";
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

    expect(findWorkerCategoryProblems([owner], new Set())).toHaveLength(1);
    expect(
      findWorkerCategoryProblems([owner], new Set(["derived.otp_mail"]))
    ).toEqual([]);
    expect(
      findWorkerCategoryProblems(
        [fixture({})],
        new Set(["derived.orphan", "hr.attendance_correction_applied"])
      )
    ).toHaveLength(1);
  });

  test("seed rows are read from migration INSERTs and not from comments", () => {
    const seeded = collectSeededWorkerCategories([
      {
        name: "410_awcms_x.sql",
        sql: `-- INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.commented');
INSERT INTO awcms_email_worker_categories (category) VALUES
  ('hr.a'), ('derived.b')
ON CONFLICT (category) DO NOTHING;`
      }
    ]);

    expect([...seeded].sort()).toEqual(["derived.b", "hr.a"]);
  });

  test("a later migration re-issuing the guard function is flagged; sql/410 and unrelated ones are not", () => {
    const create =
      "CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()";

    expect(
      findGuardFunctionReissues([
        { name: "302_awcms_a.sql", sql: create },
        { name: "410_awcms_b.sql", sql: create },
        { name: "411_awcms_c.sql", sql: create },
        { name: "412_awcms_d.sql", sql: `-- ${create}\nSELECT 1;` }
      ])
    ).toEqual(["411_awcms_c.sql"]);
  });

  test("the real repository passes every probe", () => {
    // Guards the gate against rotting into one that checks nothing: the real
    // migrations seed the three hr categories and re-issue nothing.
    const migrations = loadMigrations();

    expect(
      collectSeededWorkerCategories(migrations).size
    ).toBeGreaterThanOrEqual(3);
    expect(findGuardFunctionReissues(migrations)).toEqual([]);
    expect(
      findWorkerCategoryProblems(
        listModules(),
        collectSeededWorkerCategories(migrations)
      )
    ).toEqual([]);
  });
});
