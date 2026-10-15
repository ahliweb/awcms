/**
 * telegram-webhook-register.ts — `bun run telegram:webhook:register`.
 *
 * Issue #965 (ADR-0140 section 7). The deliberate OPERATOR act that points
 * Telegram at `POST /api/v1/telegram/webhook`. It is never run at boot or at
 * runtime: registering a webhook changes where a bot's updates go, so a person
 * does it, once, on purpose.
 *
 *     bun run telegram:webhook:register --url https://example.org/api/v1/telegram/webhook
 *     bun run telegram:webhook:register --url ... --dry-run
 *     bun run telegram:webhook:register --delete
 *
 * `--dry-run` prints the plan (the URL and the fixed `allowed_updates`, never the
 * secret or the token) and calls nothing. The rules live in
 * `telegram-webhook-registration.ts`, where they are unit-tested.
 *
 * Exits non-zero on a refused plan or a Telegram refusal, so a shell script or a
 * CI step notices. The token is in the request path; every printed string has it
 * redacted.
 */
import {
  executeWebhookRegistration,
  planWebhookRegistration
} from "../src/modules/telegram-delivery/infrastructure/telegram-webhook-registration";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  const deleting = process.argv.includes("--delete");
  const dryRun = process.argv.includes("--dry-run");
  const plan = planWebhookRegistration({
    action: deleting ? "delete" : "set",
    url: argValue("--url")
  });

  if (!plan.ok) {
    console.error(`telegram:webhook:register refused — ${plan.error}`);

    return 1;
  }

  if (dryRun) {
    console.log(`telegram:webhook:register (dry run) — ${plan.summary}`);

    return 0;
  }

  const result = await executeWebhookRegistration(plan);

  if (!result.ok) {
    console.error(`telegram:webhook:register FAILED — ${result.error}`);

    return 1;
  }

  console.log(`telegram:webhook:register — ${plan.summary}: ${result.message}`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
