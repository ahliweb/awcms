/**
 * The deployment's STAFF bot identity, for one purpose: refusing it as a
 * customer bot (ADR-0152 section 1, T-A2). Its own file so that only the
 * registration path reaches it; the dispatcher job never reads a staff setting.
 *
 * Pure module.
 */

/**
 * The numeric id of the deployment's STAFF bot (ADR-0152 section 1: "the staff
 * bot must never be registered as a customer bot").
 *
 * A bot token is `<botId>:<secret>`. Only the numeric PREFIX is read, never the
 * secret half, and nothing is stored or returned but that public number. This
 * is the single, narrow exception to "the customer code reads none of the staff
 * module's settings": ADR-0152 section 1 mandates the comparison, and the
 * comparison needs the staff bot's id. A deployment with no staff bot returns
 * `null` (nothing to compare against).
 */
export function staffBotIdFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  const match = /^([0-9]{1,20}):/.exec(token);

  return match ? match[1]! : null;
}
