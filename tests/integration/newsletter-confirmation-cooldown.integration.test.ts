/**
 * The newsletter's per-RECIPIENT ceiling, proven against a real database.
 *
 * The route's rate limiter is keyed on the client IP, so it bounds how fast one
 * SENDER may submit. It cannot bound how much mail one RECIPIENT receives — the
 * person being mailed contributes no IP to the request — and before this
 * cooldown every repeat submission of the same address re-issued a confirmation
 * token and enqueued another email. Anyone willing to rotate IPs could make
 * this deployment mail-bomb a stranger, in its own name and on its own sending
 * reputation.
 *
 * This has to be an integration test rather than a unit one. The ceiling is a
 * predicate inside the `ON CONFLICT ... DO UPDATE` statement, so the thing
 * being asserted is what POSTGRES does with a stored `confirmation_sent_at` —
 * exactly the part a mocked `Bun.SQL` would answer however the test told it to.
 * The four cases below are the four the predicate can produce, and the last two
 * are the ones that make the ceiling worth having rather than merely present.
 *
 * WORLD 2 (harness.ts) — seeded through `getHandlerAdminSql()`, and `subscribe`
 * is called with that same handle so the statement under test is the real one.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { subscribe } from "../../src/modules/newsletter/application/subscriber-directory";
import {
  validateSubscriptionRequest,
  type SubscriptionRequest
} from "../../src/modules/newsletter/domain/subscription-request";

const TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EMAIL = "reader@example.test";
const COOLDOWN_SEC = 900;

let handlerReady = false;

/**
 * Built through the real validator rather than by hand. `emailNormalized` is
 * what the unique index and the upsert both key on, so a test that computed it
 * itself would be asserting against its own normalisation, not the route's.
 */
function request(): SubscriptionRequest {
  const result = validateSubscriptionRequest({ email: EMAIL, locale: "id" });
  if (!result.valid) throw new Error("fixture address must validate");
  return result.value;
}

async function seed(): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'cooldown-t', 'Cooldown Tenant', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Move the stored send time back, which is the only way to age a row here. */
async function ageConfirmationSentAt(minutes: number): Promise<void> {
  await getHandlerAdminSql()`
    UPDATE awcms_newsletter_subscribers
    SET confirmation_sent_at = now() - make_interval(mins => ${minutes})
    WHERE tenant_id = ${TENANT}
  `;
}

async function statusOf(): Promise<string | null> {
  const rows = (await getHandlerAdminSql()`
    SELECT status FROM awcms_newsletter_subscribers WHERE tenant_id = ${TENANT}
  `) as { status: string }[];
  return rows[0]?.status ?? null;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("newsletter confirmation cooldown (integration)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (handlerReady) await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seed();
  });

  afterEach(async () => {
    if (handlerReady) await resetHandlerDatabase();
  });

  test("the FIRST submission issues a token", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    const first = await subscribe(
      sql,
      TENANT,
      request(),
      "public_form",
      COOLDOWN_SEC
    );

    expect(first.confirmationToken).not.toBeNull();
    expect(await statusOf()).toBe("pending");
  });

  test("an IMMEDIATE repeat issues NO token — the mail-bomb case", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    const first = await subscribe(
      sql,
      TENANT,
      request(),
      "public_form",
      COOLDOWN_SEC
    );
    const second = await subscribe(
      sql,
      TENANT,
      request(),
      "public_form",
      COOLDOWN_SEC
    );

    expect(first.confirmationToken).not.toBeNull();
    // The whole point: no token means the route enqueues no second email.
    expect(second.confirmationToken).toBeNull();
  });

  test("the row is left ALONE inside the window, so the emailed link still works", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    await subscribe(sql, TENANT, request(), "public_form", COOLDOWN_SEC);

    const before = (await sql`
      SELECT confirmation_token_hash, confirmation_sent_at
      FROM awcms_newsletter_subscribers WHERE tenant_id = ${TENANT}
    `) as { confirmation_token_hash: string; confirmation_sent_at: Date }[];

    await subscribe(sql, TENANT, request(), "public_form", COOLDOWN_SEC);

    const after = (await sql`
      SELECT confirmation_token_hash, confirmation_sent_at
      FROM awcms_newsletter_subscribers WHERE tenant_id = ${TENANT}
    `) as { confirmation_token_hash: string; confirmation_sent_at: Date }[];

    // A refused repeat must not rotate the hash. If it did, the link already in
    // somebody's inbox would stop working every time an attacker submitted
    // their address — turning the ceiling into a denial of the subscription it
    // was added to protect.
    expect(after[0]!.confirmation_token_hash).toBe(
      before[0]!.confirmation_token_hash
    );
    expect(after[0]!.confirmation_sent_at.getTime()).toBe(
      before[0]!.confirmation_sent_at.getTime()
    );
  });

  test("once the window has PASSED, a genuine retry is served again", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    await subscribe(sql, TENANT, request(), "public_form", COOLDOWN_SEC);
    // Past 15 minutes: somebody who never received the first mail.
    await ageConfirmationSentAt(20);

    const retry = await subscribe(
      sql,
      TENANT,
      request(),
      "public_form",
      COOLDOWN_SEC
    );

    // A ceiling that never lifts is not a ceiling, it is an outage. This is the
    // assertion that stops the fix from silently breaking real subscribers.
    expect(retry.confirmationToken).not.toBeNull();
  });

  test("a cooldown of zero restores the old behaviour exactly", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    await subscribe(sql, TENANT, request(), "public_form", 0);
    const second = await subscribe(sql, TENANT, request(), "public_form", 0);

    // Proves the predicate is what changed the outcome, and nothing else did.
    expect(second.confirmationToken).not.toBeNull();
  });

  test("a suppressed address stays refused regardless of the window", async () => {
    if (!handlerReady) return;
    const sql = getHandlerAdminSql();

    await subscribe(sql, TENANT, request(), "public_form", COOLDOWN_SEC);
    // `suppression_reason` is not optional here: the table's own CHECK requires
    // both it and `suppressed_at` whenever the status is `suppressed`, because
    // a suppression nobody can explain is one nobody can review.
    await sql`
      UPDATE awcms_newsletter_subscribers
      SET status = 'suppressed',
          suppressed_at = now(),
          suppression_reason = 'hard_bounce'
      WHERE tenant_id = ${TENANT}
    `;
    await ageConfirmationSentAt(120);

    const attempt = await subscribe(
      sql,
      TENANT,
      request(),
      "public_form",
      COOLDOWN_SEC
    );

    // The cooldown is an ADDITIONAL refusal, not a replacement for the existing
    // ones. Ageing the row must not become a way to clear a suppression.
    expect(attempt.confirmationToken).toBeNull();
    expect(await statusOf()).toBe("suppressed");
  });
});
