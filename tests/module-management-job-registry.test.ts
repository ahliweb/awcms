import { describe, expect, test } from "bun:test";

import { validateJobDescriptor } from "../src/modules/module-management/domain/job-registry";
import { fetchModuleJobs } from "../src/modules/module-management/application/job-registry";
import { listModules } from "../src/modules";

describe("validateJobDescriptor", () => {
  test("accepts a well-formed job descriptor", () => {
    const result = validateJobDescriptor({
      command: "bun run config:validate",
      purpose: "Validate required environment variables."
    });

    expect(result).toEqual({ valid: true });
  });

  test("rejects a command that isn't a bun run script", () => {
    const result = validateJobDescriptor({
      command: "npm run config:validate",
      purpose: "Validate required environment variables."
    });

    expect(result).toMatchObject({ valid: false });
    expect((result as { errors: string[] }).errors[0]).toContain(
      "bun run <script>"
    );
  });

  test("rejects a raw shell command", () => {
    const result = validateJobDescriptor({
      command: "rm -rf /tmp/whatever",
      purpose: "Something"
    });

    expect(result).toMatchObject({ valid: false });
  });

  test("rejects an empty purpose", () => {
    const result = validateJobDescriptor({
      command: "bun run config:validate",
      purpose: "   "
    });

    expect(result).toMatchObject({ valid: false });
  });

  test("collects multiple errors at once", () => {
    const result = validateJobDescriptor({
      command: "not-bun-at-all",
      purpose: ""
    });

    expect(result).toMatchObject({ valid: false });
    expect((result as { errors: string[] }).errors).toHaveLength(2);
  });
});

describe("fetchModuleJobs", () => {
  test("returns null for an unregistered module key", () => {
    expect(fetchModuleJobs("does_not_exist")).toBeNull();
  });

  test("returns an empty list for a registered module with no declared jobs", () => {
    // `tenant_admin` (Core, tenant/office data only) declares no scheduled
    // jobs — a stable "zero jobs" fixture for the base registry.
    expect(fetchModuleJobs("tenant_admin")).toEqual([]);
  });

  test("returns jobs scoped to one module, each tagged with its moduleKey", () => {
    const jobs = fetchModuleJobs("module_management");

    expect(jobs).toEqual([
      expect.objectContaining({
        moduleKey: "module_management",
        command: "bun run config:validate"
      })
    ]);
  });

  test("returns every declared job across all modules when no moduleKey is given", () => {
    const jobs = fetchModuleJobs();
    const commands = jobs!.map((job) => job.command).sort();

    expect(commands).toEqual(
      [
        "bun run config:validate",
        "bun run domain-events:dispatch",
        "bun run email:dispatch",
        "bun run email:provider:health",
        "bun run email:templates:seed-defaults",
        "bun run reporting:exports:dispatch",
        "bun run reporting:projections:refresh",
        "bun run sync:objects:dispatch",
        "bun run workflow:escalations:dispatch"
      ].sort()
    );
  });

  test("every real registered job descriptor passes shape validation", () => {
    const jobs = fetchModuleJobs()!;
    expect(jobs.length).toBeGreaterThan(0);

    for (const job of jobs) {
      const result = validateJobDescriptor(job);
      expect(result).toEqual({ valid: true });
    }
  });

  test("every real registered job descriptor's declared moduleKey is an actual registered module", () => {
    const registeredKeys = new Set(listModules().map((d) => d.key));

    for (const job of fetchModuleJobs()!) {
      expect(registeredKeys.has(job.moduleKey)).toBe(true);
    }
  });
});
