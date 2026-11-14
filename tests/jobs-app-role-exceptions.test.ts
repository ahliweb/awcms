/**
 * Scheduled jobs that run as `awcms_app` are a NAMED, REASONED list (ADR-0162).
 *
 * Issue #1132 withholds `DATABASE_URL` from every crontab job; three jobs keep
 * it on purpose (ADR-0147, ADR-0160, ADR-0162). The list lives in
 * `APP_ROLE_SCHEDULED_EXCEPTIONS`, and this file holds it to the real crontab in
 * both directions, then proves with mutated inputs that each direction fails when
 * it should (a control without a test that goes red when broken is untested).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  APP_ROLE_SCHEDULED_EXCEPTIONS,
  adrIsAccepted,
  appConnectionTargets,
  appRoleTargetsWithoutWorkerClient,
  opensAppConnection,
  validateAppRoleExceptions
} from "../scripts/jobs-env-allowlist";
import {
  resolveTargetEntry,
  traceImports
} from "../scripts/lib/job-import-graph";
import { stripComments } from "../scripts/lib/source-text";

const packageScripts: Record<string, string> = JSON.parse(
  readFileSync("package.json", "utf8")
).scripts;

const scheduled = [
  ...new Set(
    [
      ...readFileSync("ops/awcms-jobs.crontab", "utf8").matchAll(
        /^[^#\n].*\$AWCMS_RUN_JOB\s+(\S+)/gm
      )
    ].map((match) => match[1] as string)
  )
];

function appClientFiles(target: string): string[] {
  const entry = resolveTargetEntry(target, packageScripts) as string;
  return traceImports(entry).files.filter(
    (file) =>
      file !== "src/lib/database/client.ts" &&
      opensAppConnection(stripComments(readFileSync(file, "utf8")))
  );
}

let keepers: Set<string>;
beforeAll(() => {
  keepers = new Set(appConnectionTargets(packageScripts));
}, 60000);

const run = (
  exceptions: Parameters<typeof validateAppRoleExceptions>[0],
  jobs: readonly string[] = scheduled
) => validateAppRoleExceptions(exceptions, jobs, keepers, appClientFiles);

describe("APP_ROLE_SCHEDULED_EXCEPTIONS", () => {
  test("the real list matches the real crontab in both directions", () => {
    expect(run(APP_ROLE_SCHEDULED_EXCEPTIONS)).toEqual([]);
    expect(APP_ROLE_SCHEDULED_EXCEPTIONS.map((e) => e.target).sort()).toEqual([
      "email:senders:verify",
      "hr-commission:intents:post",
      "omnichannel-inbox:sla"
    ]);
  });

  test("email:senders:verify is on the crontab hourly", () => {
    const crontab = readFileSync("ops/awcms-jobs.crontab", "utf8");
    const line = crontab
      .split("\n")
      .find((l) => !l.startsWith("#") && l.includes("email:senders:verify"));

    expect(line).toBeDefined();
    expect(line).toMatch(
      /^0 \* \* \* \* \/usr\/bin\/flock -n \S+ \S+ email:senders:verify /
    );
  });

  test("every entry names an ADR file that exists and says Status: Accepted", () => {
    for (const entry of APP_ROLE_SCHEDULED_EXCEPTIONS) {
      expect(adrIsAccepted(entry.adr), entry.adr).toBe(true);
    }
    // An ADR that is merely Proposed, or that does not exist, is not one.
    expect(adrIsAccepted("ADR-0146")).toBe(false);
    expect(adrIsAccepted("ADR-9999")).toBe(false);
  });

  test("MUTANT: an entry whose ADR is Proposed or missing turns it red (audit L-3)", () => {
    const [first, ...rest] = APP_ROLE_SCHEDULED_EXCEPTIONS;
    const proposed = [
      { ...(first as (typeof rest)[number]), adr: "ADR-0146" },
      ...rest
    ];

    expect(run(proposed).join("\n")).toContain(
      "ADR-0146 is not an Accepted ADR"
    );
    expect(
      run([
        { ...(first as (typeof rest)[number]), adr: "ADR-9999" },
        ...rest
      ]).join("\n")
    ).toContain("ADR-9999 is not an Accepted ADR");
  });

  test("MUTANT: an aliased import of the app client still counts as opening the connection (audit L-4)", () => {
    expect(
      opensAppConnection(
        'import { getDatabaseClient as openApp } from "../src/lib/database/client";\nopenApp();'
      )
    ).toBe(true);
    expect(
      opensAppConnection(
        'import { getSetupDatabaseClient as s } from "../x/client";'
      )
    ).toBe(true);
    expect(opensAppConnection("getDatabaseClient();")).toBe(true);
    expect(opensAppConnection("const u = process.env.DATABASE_URL;")).toBe(
      true
    );
    expect(
      opensAppConnection(
        'import { getWorkerDatabaseClient } from "../src/lib/database/client";'
      )
    ).toBe(false);
  });

  test("the worker login is withheld from an app-role job only when its closure never reaches the worker client (audit L-5)", () => {
    const derived = appRoleTargetsWithoutWorkerClient(
      APP_ROLE_SCHEDULED_EXCEPTIONS,
      packageScripts
    );

    expect(derived).toContain("email:senders:verify");
    // a target with no entry point is never listed
    expect(
      appRoleTargetsWithoutWorkerClient(
        [{ target: "no-such-target" }],
        packageScripts
      )
    ).toEqual([]);
  });

  test("MUTANT: a scheduled job that keeps DATABASE_URL and is not listed turns it red", () => {
    const withoutOne = APP_ROLE_SCHEDULED_EXCEPTIONS.filter(
      (e) => e.target !== "email:senders:verify"
    );

    expect(run(withoutOne).join("\n")).toContain(
      "email:senders:verify is scheduled and keeps DATABASE_URL"
    );
    // ...and the same for a job that is not an exception today: pretend one more
    // crontab job keeps the credential.
    const other = scheduled.find((t) => !keepers.has(t)) as string;
    const widened = new Set([...keepers, other]);
    const problems = validateAppRoleExceptions(
      APP_ROLE_SCHEDULED_EXCEPTIONS,
      scheduled,
      widened,
      appClientFiles
    );

    expect(problems.join("\n")).toContain(`${other} is scheduled and keeps`);
  });

  test("MUTANT: an entry with no reason or no ADR turns it red", () => {
    const [first, ...rest] = APP_ROLE_SCHEDULED_EXCEPTIONS;

    expect(
      run([{ ...(first as (typeof rest)[number]), reason: "" }, ...rest]).join(
        "\n"
      )
    ).toContain("the reason is missing or too short");
    expect(
      run([{ ...(first as (typeof rest)[number]), adr: "" }, ...rest]).join(
        "\n"
      )
    ).toContain("adr must look like");
  });

  test("MUTANT: a stale entry (not scheduled, or no longer keeping the credential) turns it red", () => {
    const stale = [
      ...APP_ROLE_SCHEDULED_EXCEPTIONS,
      {
        target: "logs:audit:purge",
        adr: "ADR-0162",
        entrypoint: "scripts/audit-log-purge.ts",
        reason:
          "an ordinary worker-role job that has no business being on this list at all"
      }
    ];
    const problems = run(stale).join("\n");

    expect(problems).toContain("logs:audit:purge: listed but does not keep");
    expect(
      run(
        APP_ROLE_SCHEDULED_EXCEPTIONS,
        scheduled.filter((t) => t !== "email:senders:verify")
      ).join("\n")
    ).toContain("email:senders:verify: listed but not on the crontab");
  });

  test("MUTANT: a duplicate entry or a wrong entrypoint turns it red", () => {
    const [first] = APP_ROLE_SCHEDULED_EXCEPTIONS as readonly [
      (typeof APP_ROLE_SCHEDULED_EXCEPTIONS)[number]
    ];

    expect(run([...APP_ROLE_SCHEDULED_EXCEPTIONS, first]).join("\n")).toContain(
      "listed twice"
    );
    expect(
      run([
        { ...first, entrypoint: "scripts/somewhere-else.ts" },
        ...APP_ROLE_SCHEDULED_EXCEPTIONS.slice(1)
      ]).join("\n")
    ).toContain("the only file opening the app connection");
  });
});
