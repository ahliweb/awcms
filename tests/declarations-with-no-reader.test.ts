/**
 * Three declarations nothing read — findings D7, D8 and D15 of the 17 August
 * 2026 audit round.
 *
 * They are one file because they are one habit, and this repository already
 * keeps a memory of it: a field is declared, it passes every shape check, and
 * no runtime code ever reads it. The shape check is what makes it durable — a
 * registry gate that verifies STRUCTURE reports "present" for a value that
 * decides nothing, and the next reader takes the declaration as evidence of
 * behaviour.
 *
 * Each of the three resolved differently, and the difference is the point:
 *
 * - **D7** — the unread setting was DELETED, because the only way to make it
 *   read would weaken a control. Asserted as an absence, plus the behaviour
 *   that must not change.
 * - **D8** — the unscreened permission was moved from a register of DECISIONS
 *   to the shrink-only ledger of work not done. Asserted as membership, in
 *   both directions.
 * - **D15** — the port stays unwired, and the two comments that explained the
 *   wiring with a false fact are corrected. Asserted as source, because the
 *   defect WAS the prose.
 */
import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";
import { DELIBERATELY_UNSCREENED } from "../scripts/admin-screen-coverage-check";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";
import { tenantDomainModule } from "../src/modules/tenant-domain/module";

const DECISIONS_ROUTE = "src/pages/api/v1/workflows/tasks/[id]/decisions.ts";
const FORCE_DECISION_ROUTE =
  "src/pages/api/v1/workflows/tasks/[id]/force-decision.ts";
const COVERAGE_CHECK = "scripts/admin-screen-coverage-check.ts";
const ADAPTER =
  "src/modules/email/application/workflow-notification-port-adapter.ts";

describe("D7 — tenant_domain declares no setting nothing reads", () => {
  test("the descriptor carries no settings block at all", () => {
    expect(tenantDomainModule.settings).toBeUndefined();
  });

  test("verifyTenantDomain still requires a verification_method to exist", async () => {
    // The reason the default was deleted rather than applied. `verify` does no
    // DNS lookup of any kind — it checks this column is non-NULL and sets
    // `status = 'active'`, and an active domain feeds host->tenant resolution.
    // A default applied at creation would hand every new row the only
    // precondition there is.
    const source = stripComments(
      await Bun.file(
        "src/modules/tenant-domain/application/tenant-domain-directory.ts"
      ).text()
    );

    expect(source).toContain(
      'return { outcome: "missing_verification_method" }'
    );
  });

  test("no code path applies a default verification method", async () => {
    const validation = stripComments(
      await Bun.file(
        "src/modules/tenant-domain/domain/tenant-domain-validation.ts"
      ).text()
    );
    const directory = stripComments(
      await Bun.file(
        "src/modules/tenant-domain/application/tenant-domain-directory.ts"
      ).text()
    );

    // Neither layer may reach for the module settings to fill the column in.
    expect(validation).not.toContain("defaultVerificationMethod");
    expect(directory).not.toContain("defaultVerificationMethod");
    expect(directory).not.toContain("fetchModuleSettingsView");
  });
});

describe("D8 — an unscreened permission is counted as unbuilt, not as a judgement", () => {
  test("both enforcement keys are on the shrink-only ledger", () => {
    expect(NOT_YET_SCREENED).toContain("media_library.enforcement.read");
    expect(NOT_YET_SCREENED).toContain("media_library.enforcement.enable");
  });

  test("neither is still filed as a deliberate decision", async () => {
    // Comment-stripped: the check file now EXPLAINS the move by quoting the old
    // entries. Reading that explanation as a live entry is the mistake this
    // assertion would otherwise make.
    const source = stripComments(await Bun.file(COVERAGE_CHECK).text());

    expect(source).not.toContain('"media_library.enforcement.read":');
    expect(source).not.toContain('"media_library.enforcement.enable":');
  });

  test("no key is both a decision and a ledger line", () => {
    // The two lists mean opposite things; an entry in both would let unfinished
    // work keep the appearance of judgement, which is the failure D8 is. The
    // register is exported for this — a version of this test that tolerated a
    // missing export would pass by doing nothing, which is the same shape as
    // the finding.
    expect(Object.keys(DELIBERATELY_UNSCREENED).length).toBeGreaterThan(0);

    for (const key of NOT_YET_SCREENED) {
      expect(key in DELIBERATELY_UNSCREENED, `${key} is on both lists`).toBe(
        false
      );
    }
  });
});

describe("D15 — the workflow notification port, and two comments that were false", () => {
  test("neither route still claims the email module is unported", async () => {
    const decisions = await Bun.file(DECISIONS_ROUTE).text();
    const force = await Bun.file(FORCE_DECISION_ROUTE).text();

    // `email` is live and owns the adapter. The claim was true under the
    // original port and stayed after it stopped being true.
    expect(decisions).not.toContain("has not\n// been ported yet");
    expect(decisions).toContain("`email` is a live module in this repo");
    expect(force).toContain("it is live and owns the adapter");
  });

  test("the adapter's own docblock says it has no importers", async () => {
    const adapter = await Bun.file(ADAPTER).text();

    // Its header says "only a composition root may import this file", which
    // reads as though one does. It now states that none does, and why.
    expect(adapter).toContain("NOTHING IMPORTS IT TODAY");
  });

  test("the port is still not injected, and the path is still unreachable", async () => {
    const decisions = stripComments(await Bun.file(DECISIONS_ROUTE).text());
    const force = stripComments(await Bun.file(FORCE_DECISION_ROUTE).text());

    // If a future change injects it, this test should fail and be deleted in
    // the same commit that gives instance creation a caller — the two belong
    // together, which is the whole argument for not doing it here.
    expect(decisions).not.toContain("createEmailWorkflowNotificationAdapter");
    expect(force).not.toContain("createEmailWorkflowNotificationAdapter");
  });
});
