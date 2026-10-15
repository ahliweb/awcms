/**
 * The registry gate of ADR-0140 section 1 (`bun run telegram:templates:check`),
 * driven with planted sources so it is proved to FAIL where it must, not merely to
 * pass on today's tree. Includes the reproductions from the security audit (M4):
 * `hr_commission.statement_ready`, `hr.payslip_ready` and an aliased import.
 */
import { afterAll, describe, expect, test } from "bun:test";

import {
  declaredPayrollModuleDirs,
  payrollDirProblems,
  evaluateLiveRegistry,
  evaluateRegistrationSites,
  extractRegistrationCalls,
  isPayrollOwningPath,
  scanPayrollModuleTouch,
  scanSystemKeyCaller,
  scanRegistrationSite
} from "../scripts/telegram-templates-check";
import { listModules } from "../src/modules";
import {
  listTelegramTemplates,
  registerTelegramTemplate,
  resetTelegramTemplatesForTests,
  TelegramTemplateRegistrationError
} from "../src/modules/telegram-delivery/domain/telegram-templates";

const site = (file: string, source: string) =>
  scanRegistrationSite(file, source)!;

describe("telegram:templates:check", () => {
  test("the real tree is clean, and hr_commission is DECLARED payroll-bearing", () => {
    expect(evaluateLiveRegistry(listTelegramTemplates())).toEqual([]);
    expect(listTelegramTemplates().map((t) => t.key)).toContain(
      "system.ops_alert"
    );
    expect(
      listModules().find((m) => m.key === "hr_commission")!.handlesPayrollData
    ).toBe(true);
    expect(declaredPayrollModuleDirs()).toContain("src/modules/hr-commission/");
  });

  test("a registration call is found, balanced parentheses and all, and comments are ignored", () => {
    const calls = extractRegistrationCalls(`
      // registerTelegramTemplate({ key: "ignored.commented" })
      registerTelegramTemplate({
        key: "booking.staff_reminder",
        body: "Count (see below) {{count}}",
        variables: [{ name: "count", kind: "count" }]
      });
    `);

    expect(calls).toHaveLength(2);

    const found = scanRegistrationSite(
      "src/modules/booking/x.ts",
      `registerTelegramTemplate({ ownerModuleKey: "booking", key: "booking.staff_reminder", variables: [{ name: "count", kind: "count" }] });`
    )!;

    expect(found.keys).toEqual(["booking.staff_reminder"]);
    expect(found.owners).toEqual(["booking"]);
    expect(found.variableNames).toEqual(["count"]);
    expect(scanRegistrationSite("x.ts", "const nothing = 1;")).toBeNull();
  });

  test("a clean registration passes", () => {
    expect(
      evaluateRegistrationSites([
        site(
          "src/modules/booking/templates.ts",
          `registerTelegramTemplate({ ownerModuleKey: "booking", key: "booking.staff_reminder", version: 1, body: "Shift soon: {{count}}", variables: [{ name: "count", kind: "count" }] });`
        )
      ])
    ).toEqual([]);
  });

  test("a template registered FROM a payroll-owning module fails, whatever it is called", () => {
    expect(
      isPayrollOwningPath("src/modules/hr-payroll/application/notice.ts")
    ).toBe(true);
    expect(
      isPayrollOwningPath("src/modules/hr-commission/application/x.ts")
    ).toBe(true);
    expect(
      isPayrollOwningPath("src/modules/hr-workforce/application/x.ts")
    ).toBe(false);

    const problems = evaluateRegistrationSites([
      site(
        "src/modules/hr-commission/application/notice.ts",
        `registerTelegramTemplate({ ownerModuleKey: "hr_commission", key: "hr_commission.statement_ready", variables: [] });`
      )
    ]);

    expect(problems.join("\n")).toMatch(/payroll-owning module/);
    expect(problems.join("\n")).toMatch(/hr_commission/);
  });

  test("hr.payslip_ready from an ordinary module fails on the key, the owner and the prefix", () => {
    const problems = evaluateRegistrationSites([
      site(
        "src/modules/booking/x.ts",
        `registerTelegramTemplate({ ownerModuleKey: "booking", key: "hr.payslip_ready", variables: [] });`
      )
    ]);

    expect(problems.join("\n")).toMatch(/not prefixed with its ownerModuleKey/);
  });

  test("an ALIASED import is still found and still fails from a payroll module", () => {
    const source = `
      import { registerTelegramTemplate as reg } from "../../telegram-delivery/domain/telegram-templates";
      reg({ ownerModuleKey: "hr_commission", key: "hr_commission.statement_ready", variables: [] });
    `;
    const found = site("src/modules/hr-commission/x.ts", source);

    expect(found.keys).toEqual(["hr_commission.statement_ready"]);
    expect(evaluateRegistrationSites([found]).join("\n")).toMatch(
      /payroll-owning module/
    );
  });

  test("a namespace import call is found; an assignment or re-export is flagged indirect", () => {
    const ns = site(
      "src/modules/booking/x.ts",
      `import * as T from "../../telegram-delivery/domain/telegram-templates";
       T.registerTelegramTemplate({ ownerModuleKey: "booking", key: "booking.a", variables: [] });`
    );

    expect(ns.keys).toEqual(["booking.a"]);
    expect(ns.indirect).toBe(false);

    const assigned = site(
      "src/modules/booking/x.ts",
      `import { registerTelegramTemplate } from "../../telegram-delivery/domain/telegram-templates";
       const go = registerTelegramTemplate;
       go({ key: "booking.a" });`
    );

    expect(assigned.indirect).toBe(true);
    expect(evaluateRegistrationSites([assigned]).join("\n")).toMatch(
      /other than by a direct call/
    );

    const dynamic = site(
      "src/modules/booking/x.ts",
      `const m = await import("../../telegram-delivery/domain/telegram-templates");`
    );

    expect(dynamic.indirect).toBe(true);
  });

  test("a payroll-bearing module that merely IMPORTS the Telegram port fails, with no call at all", () => {
    expect(
      scanPayrollModuleTouch(
        "src/modules/hr-commission/application/x.ts",
        `import type { TelegramDeliveryPort } from "../../_shared/ports/telegram-delivery-port";`
      )
    ).toMatch(/payroll-bearing module/);
    expect(
      scanPayrollModuleTouch(
        "src/modules/booking/application/x.ts",
        `import type { TelegramDeliveryPort } from "../../_shared/ports/telegram-delivery-port";`
      )
    ).toBeNull();
    expect(
      scanPayrollModuleTouch(
        "src/modules/hr-commission/application/x.ts",
        `// the Telegram port is not used here\nconst a = 1;`
      )
    ).toBeNull();
  });

  test("an owner that is not the file's own module fails", () => {
    const problems = evaluateRegistrationSites([
      site(
        "src/modules/booking/x.ts",
        `registerTelegramTemplate({ ownerModuleKey: "workflow_approval", key: "workflow_approval.a", variables: [] });`
      )
    ]);

    expect(problems.join("\n")).toMatch(/not the module this file belongs to/);
  });

  test("payroll wording in a literal body fails", () => {
    const problems = evaluateRegistrationSites([
      site(
        "src/modules/booking/x.ts",
        `registerTelegramTemplate({ ownerModuleKey: "booking", key: "booking.a", body: "Your gaji is ready", variables: [] });`
      )
    ]);

    expect(problems.join("\n")).toMatch(/payroll term "gaji"/);
  });

  test("every deny-listed variable name fails, in English, Indonesian, plurals and synonyms", () => {
    for (const name of [
      "customerName",
      "phone",
      "email",
      "address",
      "netSalary",
      "amount",
      "note",
      "nik",
      "nama",
      "alamat",
      "telp",
      "hp",
      "gaji",
      "upah",
      "bonus",
      "wages",
      "salaries",
      "payee",
      "gross",
      "net",
      "commission",
      "names",
      "addresses"
    ]) {
      const problems = evaluateRegistrationSites([
        site(
          "src/modules/booking/x.ts",
          `registerTelegramTemplate({ ownerModuleKey: "booking", key: "booking.x", variables: [{ name: "${name}", kind: "reference" }] });`
        )
      ]);

      expect(problems.join("\n")).toContain(name);
    }
  });
});

describe("audit N1 and N5: payroll-owned files outside src/modules, and a missing directory", () => {
  const src = `import { enqueueTelegramMessage } from "../../../../modules/telegram-delivery/application/telegram-enqueue";`;

  test.each([
    "src/pages/api/v1/hr-commission/accruals/[id]/pay.ts",
    "src/pages/admin/hr-commission/index.astro",
    "scripts/hr-commission-export.ts"
  ])("%s is owned by hr_commission, so touching the port fails", (file) => {
    expect(isPayrollOwningPath(file)).toBe(true);
    expect(scanPayrollModuleTouch(file, src)).toMatch(/payroll-bearing module/);
  });

  test("an ordinary route, page or script is not", () => {
    for (const file of [
      "src/pages/api/v1/booking/schedules.ts",
      "src/pages/admin/booking.astro",
      "scripts/booking-holds-expire.ts"
    ]) {
      expect(isPayrollOwningPath(file)).toBe(false);
      expect(scanPayrollModuleTouch(file, src)).toBeNull();
    }
  });

  test("a declared module whose directory is missing FAILS the gate instead of scanning nothing", () => {
    expect(payrollDirProblems(declaredPayrollModuleDirs())).toEqual([]);
    expect(
      payrollDirProblems(["src/modules/hr-payroll/"], () => false).join("\n")
    ).toMatch(/does not exist/);
    expect(
      declaredPayrollModuleDirs([
        { key: "hr_payroll", handlesPayrollData: true }
      ])
    ).toEqual(["src/modules/hr-payroll/"]);
  });
});

describe("audit M1 (round 3): nothing outside telegram_delivery can enqueue a system.* key", () => {
  const caller = `import { enqueueTelegramMessage } from "../../telegram-delivery/application/telegram-enqueue";
    await enqueueTelegramMessage(tx, { templateKey: "system.ops_alert", variables: {} });`;

  test("a scratch caller that names a system.* key beside the enqueue path is RED", () => {
    expect(
      scanSystemKeyCaller("src/modules/booking/application/x.ts", caller)
    ).toMatch(/system\.\* template key/);
    expect(
      scanSystemKeyCaller(
        "scripts/x.ts",
        `import { enqueueActivationNotice } from "../src/modules/telegram-delivery/application/telegram-enqueue";`
      )
    ).toMatch(/internal sender/);
    expect(
      scanSystemKeyCaller(
        "src/pages/api/v1/x.ts",
        `const o = { allowSystemTemplates: true };`
      )
    ).toMatch(/internal sender/);
  });

  test("telegram_delivery itself, comments, and an ordinary template are fine", () => {
    expect(
      scanSystemKeyCaller(
        "src/modules/telegram-delivery/application/telegram-enqueue.ts",
        caller
      )
    ).toBeNull();
    expect(
      scanSystemKeyCaller(
        "src/modules/booking/x.ts",
        `// "system.ops_alert" is not ours\nconst a = 1;`
      )
    ).toBeNull();
    expect(
      scanSystemKeyCaller(
        "src/modules/booking/x.ts",
        `import { enqueueTelegramMessage } from "../../telegram-delivery/application/telegram-enqueue";
         await enqueueTelegramMessage(tx, { templateKey: "booking.staff_reminder" });`
      )
    ).toBeNull();
  });

  test("the exported enqueue options carry no way to lift the refusal", async () => {
    const source = await Bun.file(
      "src/modules/telegram-delivery/application/telegram-enqueue.ts"
    ).text();
    const optionsType = /export type EnqueueTelegramOptions = \{[^}]*\}/.exec(
      source
    )![0];

    expect(optionsType).not.toMatch(/system|allow/i);
  });
});

describe("audit L1 (round 3): cheap gate widenings", () => {
  test("a route prefix matches on a path boundary, not a bare prefix", () => {
    expect(isPayrollOwningPath("src/pages/api/v1/hr-commission/x.ts")).toBe(
      true
    );
    expect(isPayrollOwningPath("src/pages/api/v1/hr-commissioner/x.ts")).toBe(
      false
    );
  });

  test("snake_case and kebab-case path tokens are caught anywhere under src/ and scripts/", () => {
    for (const file of [
      "src/lib/hr_commission/notify.ts",
      "src/lib/hr-commission/notify.ts",
      "src/components/hr-commission-card.astro",
      "scripts/hr_commission_export.ts"
    ]) {
      expect(isPayrollOwningPath(file)).toBe(true);
    }

    expect(isPayrollOwningPath("src/lib/booking/notify.ts")).toBe(false);
  });

  test.each([
    "Pembayaran diterima",
    "Bayaran bulan ini",
    "Insentif cair",
    "Imbalan jasa",
    "Honorarium dibayar",
    "Honor anda",
    "Penghasilan minggu ini",
    "Incentives are due"
  ])("%s", (body) => {
    expect(() =>
      registerTelegramTemplate(
        {
          ownerModuleKey: "booking",
          key: "booking.l1_check",
          version: 1,
          purpose: "staff_ops",
          body,
          variables: []
        },
        { owners: () => [{ key: "booking" }] }
      )
    ).toThrow(/payroll term/);
  });
});

describe("registration itself refuses the same things (the gate is the second layer)", () => {
  afterAll(() => resetTelegramTemplatesForTests());

  const owners = () => [
    { key: "booking" },
    { key: "hr_commission", handlesPayrollData: true }
  ];
  const base = {
    version: 1,
    purpose: "staff_ops" as const,
    body: "Shift soon: {{count}}",
    variables: [{ name: "count", kind: "count" as const }]
  };
  const register = (over: Record<string, unknown>) =>
    registerTelegramTemplate(
      {
        ownerModuleKey: "booking",
        key: "booking.audit_check",
        ...base,
        ...over
      } as never,
      { owners }
    );

  test("a flagged owner is refused, and so is hr.payslip_ready under any owner", () => {
    expect(() =>
      register({
        ownerModuleKey: "hr_commission",
        key: "hr_commission.statement_ready"
      })
    ).toThrow(TelegramTemplateRegistrationError);
    expect(() => register({ key: "hr.payslip_ready" })).toThrow(
      TelegramTemplateRegistrationError
    );
    expect(() =>
      register({ ownerModuleKey: "hr", key: "hr.payslip_ready" })
    ).toThrow(/not a registered module|reads as payroll/);
  });

  test("a key prefix must be the registering module's own key", () => {
    expect(() => register({ key: "workflow_approval.a" })).toThrow(
      /must be prefixed with/
    );
  });

  test("payroll wording is refused, in either language", () => {
    expect(() =>
      register({ key: "booking.w1", body: "Your payslip is ready" })
    ).toThrow(/payroll term/);
    expect(() =>
      register({ key: "booking.w2", body: "Gaji bulan ini cair" })
    ).toThrow(/payroll term/);
    expect(() =>
      register({ key: "booking.w3", body: "Bonuses are due" })
    ).toThrow(/payroll term/);
  });

  test("a clean template from a normal owner registers", () => {
    expect(() => register({ key: "booking.audit_ok" })).not.toThrow();
  });
});
