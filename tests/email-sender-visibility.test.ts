/**
 * The ONE confinement rule shared by `GET /api/v1/email/senders` and the
 * `/admin/email-senders` screen (Issue #1162 audit M-1). Pure: the channel
 * access is a hand-written fake, so every branch of the rule is pinned by a test
 * that turns red when the branch is weakened (default-allow `canSee`, the
 * deployment lane shown to a confined caller, a policy scope check that always
 * passes, an absent access that lists something).
 */
import { describe, expect, test } from "bun:test";

import { filterVisibleEmailSenders } from "../src/modules/email/application/email-sender-visibility";
import type {
  EmailSenderAccess,
  EmailSenderAccessContext,
  EmailSenderAccessGuard
} from "../src/modules/email/infrastructure/channel-account-loaders";
import type {
  EmailSenderDiagnostics,
  EmailSenderPolicyView
} from "../src/modules/email/application/email-sender-directory";

const context = {} as unknown as EmailSenderAccessContext;
const guard: EmailSenderAccessGuard = {
  moduleKey: "email",
  activityCode: "senders",
  action: "read"
};
const MINE = "00000000-0000-4000-8000-000000000001";
const THEIRS = "00000000-0000-4000-8000-000000000002";
const HELD = { type: "office", id: "office-held" };
const NOT_HELD = { type: "office", id: "office-not-held" };

const lane = (senderAccountId: string | null): EmailSenderDiagnostics => ({
  senderAccountId,
  availability: null,
  queue: { waiting: 1, sending: 0, failed: 0, oldestPendingAt: null },
  quota: { sentLastHour: 0, hourlyLimit: 10, throttled: false }
});
const policy = (
  businessScope: { type: string; id: string } | null,
  defaultSenderAccountId: string | null
): EmailSenderPolicyView => ({
  id: `policy-${businessScope?.id ?? "tenant"}`,
  businessScope,
  defaultSenderAccountId,
  configVersion: 1,
  effectiveFrom: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z"
});
const fakeAccess = (confined: boolean): EmailSenderAccess => ({
  authorizeScope: async () => null,
  canUseAccount: async (_c, _g, accountId) => accountId === MINE,
  scopeCovered: async (_c, _g, scope) => scope.id === HELD.id,
  isConfined: async () => confined
});

const diagnostics = [lane(null), lane(MINE), lane(THEIRS)];

describe("filterVisibleEmailSenders", () => {
  test("a sender the caller cannot use is left out, one it can use stays", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      fakeAccess(false),
      diagnostics,
      []
    );

    expect(out.senders.map((s) => s.senderAccountId)).toEqual([null, MINE]);
  });

  test("a confined caller gets no deployment lane and no tenant-wide policy", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      fakeAccess(true),
      diagnostics,
      [policy(null, null), policy(HELD, MINE)]
    );

    expect(out.confined).toBe(true);
    expect(out.senders.map((s) => s.senderAccountId)).toEqual([MINE]);
    expect(out.policies.map((p) => p.businessScope)).toEqual([HELD]);
  });

  test("an unconfined caller keeps the deployment lane and the tenant-wide policy", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      fakeAccess(false),
      diagnostics,
      [policy(null, null)]
    );

    expect(out.confined).toBe(false);
    expect(out.senders.map((s) => s.senderAccountId)).toContain(null);
    expect(out.policies).toHaveLength(1);
  });

  test("a policy of a scope the caller does not hold is filtered out", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      fakeAccess(false),
      [],
      [policy(HELD, MINE), policy(NOT_HELD, MINE)]
    );

    expect(out.policies.map((p) => p.businessScope?.id)).toEqual([HELD.id]);
  });

  test("a policy that names a sender the caller cannot see is filtered out", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      fakeAccess(false),
      [],
      [policy(HELD, THEIRS)]
    );

    expect(out.policies).toEqual([]);
  });

  test("a null access (channel module not loadable) lists nothing and is confined", async () => {
    const out = await filterVisibleEmailSenders(
      context,
      guard,
      null,
      diagnostics,
      [policy(null, null), policy(HELD, MINE)]
    );

    expect(out).toEqual({ confined: true, senders: [], policies: [] });
  });
});
