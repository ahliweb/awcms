/**
 * Deploy-time half of the payroll DPIA-addendum gate (Issue #1449).
 *
 * The runtime half (`src/modules/_shared/payroll-dpia-addendum-gate.ts`) only
 * sees three environment variables, because the production image has no `docs/`
 * directory. This half reads the named artifact from the repository checkout,
 * hashes it and checks its gate record. `bun run config:validate` and
 * `bun run security:readiness` run it; neither runs in the request path.
 *
 * No variable set is fine ("payroll deliberately off"): the runtime gate then
 * refuses everything on its own. HALF set, or set but not backed by an approved
 * artifact, is always a problem, because it is a deployment that believes it is
 * cleared.
 */
import { join } from "node:path";

import {
  PAYROLL_ADDENDUM_DIRECTORY,
  payrollAddendumArtifactProblems,
  readPayrollAddendumFromEnv,
  type EnvBag
} from "../../src/modules/_shared/payroll-dpia-addendum-gate";

export type PayrollAddendumDeployState =
  | { state: "off"; problems: [] }
  | { state: "approved"; ref: string; problems: [] }
  | { state: "invalid"; problems: string[] };

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function checkPayrollAddendumArtifact(
  env: EnvBag,
  options: { root?: string; now?: Date } = {}
): Promise<PayrollAddendumDeployState> {
  const parsed = readPayrollAddendumFromEnv(env, options.now);

  if (!parsed.ok) {
    return parsed.configured
      ? { state: "invalid", problems: parsed.problems }
      : { state: "off", problems: [] };
  }

  const root = options.root ?? process.cwd();
  const path = join(
    root,
    PAYROLL_ADDENDUM_DIRECTORY,
    `${parsed.record.ref}.md`
  );
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return {
      state: "invalid",
      problems: [
        `${PAYROLL_ADDENDUM_DIRECTORY}/${parsed.record.ref}.md does not exist: the recorded addendum is not in this checkout.`
      ]
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problems = payrollAddendumArtifactProblems({
    markdown: new TextDecoder().decode(bytes),
    actualSha256: sha256Hex(bytes),
    expected: parsed.record
  });

  return problems.length > 0
    ? { state: "invalid", problems }
    : { state: "approved", ref: parsed.record.ref, problems: [] };
}
