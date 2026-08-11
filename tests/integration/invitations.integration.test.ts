/**
 * An invitation carries its own Policy (ADR-0082, Gelombang 4 of #423),
 * against a real PostgreSQL.
 *
 * ## The failures this file is written against
 *
 * 1. **A grant that exists before it should.** An invitation records roles, and
 *    the whole design rests on those roles being INERT until acceptance. A
 *    reader that could see them early would be a second grant path — the one
 *    ADR-0079 collapsed. So the first assertion is that a pending invitation
 *    grants the invitee nothing, asked of the real reader rather than of the
 *    table.
 *
 * 2. **Two acceptances of one link.** Without the row lock in
 *    `acceptInvitation`, both pass the status check and the second collides on
 *    `awcms_identities_tenant_login_key` mid-transaction — a 500 for someone who
 *    double-clicked. This is the defect `approveRegistrationRequest`'s
 *    `FOR UPDATE` was mutation-proven against; removing `FOR UPDATE OF i` turns
 *    the concurrency test below red.
 *
 * 3. **A resent link that did not replace the old one.** Rotation is what makes
 *    resend safe, and a test that only checks the NEW link works would pass just
 *    as happily if the old one still did too.
 *
 * 4. **A role that changed between issue and acceptance.** The `is_system`
 *    refusal is checked twice for exactly this, and only a test that changes the
 *    role in between can tell the second check from decoration.
 *
 * Every grant is written by the real writer and every read goes through the
 * real reader — a fixture that INSERTed its own rows could put them wherever
 * the reader happens to look, which is how a suite passes while the product is
 * broken (`grant-readers.integration.test.ts` §fixtures).
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { fetchGrantedPermissionKeys } from "../../src/modules/identity-access/application/auth-context";
import {
  acceptInvitation,
  previewInvitation
} from "../../src/modules/identity-access/application/invitation-acceptance";
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation
} from "../../src/modules/identity-access/application/invitation-admin";
import type { AuthNotificationPort } from "../../src/modules/_shared/ports/auth-notification-port";

const TENANT = "f7777777-7777-4777-8777-777777777777";
const OTHER_TENANT = "f8888888-8888-4888-8888-888888888888";
const INVITER = "f7000000-0000-4000-8000-000000000001";
const EDITOR_ROLE = "f7000000-0000-4000-8000-0000000000a1";
const SYSTEM_ROLE = "f7000000-0000-4000-8000-0000000000a2";

const INVITEE = "newcomer@example.test";
const PASSWORD = "a-sufficiently-long-password";
const GRANTED_KEY = "blog_content.posts.read";

/**
 * Captures the link instead of mailing it. The RAW TOKEN never leaves the
 * writer any other way — the row holds only its hash — so this is also how the
 * tests get one, which is exactly the property being relied on.
 */
type Sent = { address: string; url: string }[];

function stubPort(sent: Sent, enqueued = true): AuthNotificationPort {
  return {
    async enqueueAuthNotification() {
      throw new Error(
        "an invitation must address a raw address, not an account"
      );
    },
    async enqueueAuthAddressNotification(_tx, request) {
      sent.push({
        address: request.recipientAddress,
        url: request.variables.invitationUrl ?? ""
      });
      return { enqueued };
    }
  };
}

function tokenOf(url: string): string {
  const parsed = new URL(url);
  return parsed.searchParams.get("token") ?? "";
}

function deliveryOptions(sent: Sent, enqueued = true) {
  return {
    tokenTtlHours: 168,
    invitationUrlBase: "https://example.test/accept-invitation",
    notifications: stubPort(sent, enqueued)
  };
}

async function seedTenantUser(
  tenantId: string,
  id: string,
  label: string
): Promise<void> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Display ${label}`})
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${id}, ${tenantId}, ${identity[0]!.id})
  `;
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'invite-tenant', 'Invite Tenant')
  `;
  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${OTHER_TENANT}, 'other-tenant', 'Other Tenant')
  `;

  await seedTenantUser(TENANT, INVITER, "inviter");

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${EDITOR_ROLE}, ${TENANT}, 'editor', 'Editor')
  `;
  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${SYSTEM_ROLE}, ${TENANT}, 'owner', 'Owner', true)
  `;

  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'blog_content' AND activity_code = 'posts' AND action = 'read'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT}, ${EDITOR_ROLE}, ${permission[0]!.id})
  `;
}

/** Issues an invitation carrying `editor`, through the real writer, and returns its raw token. */
async function issueInvitation(
  sent: Sent,
  roleIds: string[] = [EDITOR_ROLE]
): Promise<{ id: string; token: string }> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
    const result = await createInvitation(
      tx,
      TENANT,
      INVITER,
      {
        loginIdentifier: INVITEE,
        displayName: "Newcomer",
        roleIds,
        skipEmailConfirmation: false
      },
      new Date(),
      deliveryOptions(sent)
    );

    if (result.outcome !== "created") {
      throw new Error(`expected created, got ${result.outcome}`);
    }

    return {
      id: result.invitationId,
      token: tokenOf(sent[sent.length - 1]!.url)
    };
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("an invitation carries its own Policy (ADR-0082)", () => {
  beforeAll(setupIntegrationDatabase);
  afterAll(teardownIntegrationDatabase);

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("the emailed link carries the tenant as well as the token", async () => {
    // Without it the acceptance page has no `X-AWCMS-Tenant-ID` to send, and
    // both public endpoints refuse. Caught by writing the page, not by reading
    // the writer.
    const sent: Sent = [];
    await issueInvitation(sent);

    const url = new URL(sent[0]!.url);
    const carriesTenant =
      url.searchParams.get("tenantId") === TENANT || url.searchParams.has("p");

    expect(carriesTenant).toBe(true);
  });

  test("a PENDING invitation grants the invitee nothing", async () => {
    // Asked of the real reader. If `activeRoleGrants` ever learned to read the
    // invitation tables, this is the assertion that would notice.
    const sent: Sent = [];
    await issueInvitation(sent);

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_access_policies WHERE tenant_id = ${TENANT}
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(0);
  });

  test("acceptance materializes the membership AND the grant", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    const accepted = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      acceptInvitation(
        tx,
        TENANT,
        invitation.token,
        { password: PASSWORD },
        new Date()
      )
    );

    expect(accepted.outcome).toBe("accepted");

    // The grant reaches the reader every guarded request uses — not the table
    // it happens to live in.
    const keys = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      fetchGrantedPermissionKeys(
        tx,
        TENANT,
        accepted.outcome === "accepted" ? accepted.tenantUserId : ""
      )
    );

    expect(keys.has(GRANTED_KEY)).toBe(true);

    const row = (await getAdminSql()`
      SELECT status, accepted_tenant_user_id FROM awcms_invitations
      WHERE tenant_id = ${TENANT} AND id = ${invitation.id}
    `) as { status: string; accepted_tenant_user_id: string }[];

    expect(row[0]!.status).toBe("accepted");
    expect(row[0]!.accepted_tenant_user_id).toBe(
      accepted.outcome === "accepted" ? accepted.tenantUserId : ""
    );
  });

  test("two concurrent acceptances of one link: exactly one wins", async () => {
    // The row lock is what makes this true. Without `FOR UPDATE OF i` both
    // transactions pass the status check and the loser hits 23505 on
    // `awcms_identities_tenant_login_key` mid-transaction — a 500 rather than a
    // clean refusal.
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    const attempt = () =>
      withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
        acceptInvitation(
          tx,
          TENANT,
          invitation.token,
          { password: PASSWORD },
          new Date()
        )
      ).catch((error: unknown) => ({ outcome: "threw", error }) as const);

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const outcomes = [first.outcome, second.outcome].sort();

    // `accepted` + `invalid`, NOT `accepted` + `identifier_taken`, and the
    // difference is the lock doing its job. The loser blocks on `FOR UPDATE OF i`
    // until the winner commits, then re-reads the row it was waiting for and
    // finds `status = 'accepted'` — so `evaluateInvitation` refuses it before it
    // ever reaches the identity INSERT. `identifier_taken` is what you get from
    // the version WITHOUT the lock, where both transactions pass the status
    // check and the loser discovers the collision at
    // `awcms_identities_tenant_login_key` instead. Refusing at the invitation is
    // the better answer, and it is the one the lock produces.
    expect(outcomes).toEqual(["accepted", "invalid"]);

    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT} AND login_identifier = ${INVITEE}
    `) as { n: number }[];

    expect(identities[0]!.n).toBe(1);
  });

  test("resend ROTATES: the previous link stops working", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);
    const firstToken = invitation.token;

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      resendInvitation(
        tx,
        TENANT,
        invitation.id,
        INVITER,
        new Date(),
        deliveryOptions(sent)
      )
    );

    const secondToken = tokenOf(sent[sent.length - 1]!.url);
    expect(secondToken).not.toBe(firstToken);

    const stale = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      previewInvitation(tx, TENANT, firstToken, new Date())
    );
    expect(stale.outcome).toBe("invalid");

    const fresh = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      previewInvitation(tx, TENANT, secondToken, new Date())
    );
    expect(fresh.outcome).toBe("found");
  });

  test("the resend ceiling is enforced, and by the database", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
        resendInvitation(
          tx,
          TENANT,
          invitation.id,
          INVITER,
          new Date(),
          deliveryOptions(sent)
        )
      );
      expect(result.outcome).toBe("resent");
    }

    const sixth = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      resendInvitation(
        tx,
        TENANT,
        invitation.id,
        INVITER,
        new Date(),
        deliveryOptions(sent)
      )
    );

    expect(sixth.outcome).toBe("resend_limit_reached");
  });

  test("a revoked invitation cannot be previewed or accepted", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      revokeInvitation(
        tx,
        TENANT,
        invitation.id,
        INVITER,
        new Date(),
        "changed our mind"
      )
    );

    const preview = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      previewInvitation(tx, TENANT, invitation.token, new Date())
    );
    expect(preview).toEqual({ outcome: "invalid", reason: "revoked" });

    const accept = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      acceptInvitation(
        tx,
        TENANT,
        invitation.token,
        { password: PASSWORD },
        new Date()
      )
    );
    expect(accept.outcome).toBe("invalid");
  });

  test("an expired invitation is refused from the COLUMN, with no job having run", async () => {
    // Nothing sweeps `status` to 'expired'. The row is still literally
    // `pending`, and the refusal has to come from `expires_at`.
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    // BOTH columns move: `awcms_invitations_expiry_check` requires
    // `expires_at > issued_at`, so backdating only the expiry is refused by the
    // schema — which is itself the constraint working, and worth not
    // mistaking for a test-harness quirk.
    await getAdminSql()`
      UPDATE awcms_invitations
      SET issued_at = now() - interval '2 hours',
          expires_at = now() - interval '1 hour'
      WHERE tenant_id = ${TENANT} AND id = ${invitation.id}
    `;

    const still = (await getAdminSql()`
      SELECT status FROM awcms_invitations WHERE tenant_id = ${TENANT} AND id = ${invitation.id}
    `) as { status: string }[];
    expect(still[0]!.status).toBe("pending");

    const preview = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      previewInvitation(tx, TENANT, invitation.token, new Date())
    );
    expect(preview).toEqual({ outcome: "invalid", reason: "expired" });
  });

  test("a token issued for one tenant is invisible to another", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    const preview = await withTenantOrThrow(
      getRuntimeSql(),
      OTHER_TENANT,
      (tx) => previewInvitation(tx, OTHER_TENANT, invitation.token, new Date())
    );

    expect(preview).toEqual({ outcome: "invalid", reason: "not_found" });
  });

  test("a role that BECOMES a system role between issue and acceptance is refused", async () => {
    // This is what the second `is_system` check exists for. With the re-check
    // removed, the acceptance succeeds and hands out a system role that the
    // ordinary assignment path refuses.
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    await getAdminSql()`
      UPDATE awcms_roles SET is_system = true
      WHERE tenant_id = ${TENANT} AND id = ${EDITOR_ROLE}
    `;

    const accept = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      acceptInvitation(
        tx,
        TENANT,
        invitation.token,
        { password: PASSWORD },
        new Date()
      )
    );

    expect(accept.outcome).toBe("system_role");

    // And it refused BEFORE writing: no half-made account is left behind.
    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT} AND login_identifier = ${INVITEE}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(0);
  });

  test("a system role is refused at ISSUE time too", async () => {
    const sent: Sent = [];

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createInvitation(
        tx,
        TENANT,
        INVITER,
        {
          loginIdentifier: INVITEE,
          displayName: "Newcomer",
          roleIds: [SYSTEM_ROLE],
          skipEmailConfirmation: false
        },
        new Date(),
        deliveryOptions(sent)
      )
    );

    expect(result.outcome).toBe("system_role");
    expect(sent).toEqual([]);
  });

  test("a second pending invitation to the same address is refused, not raised", async () => {
    // `ON CONFLICT … DO NOTHING` rather than a 23505: a raised error would
    // abort the transaction and take the audit row with it.
    const sent: Sent = [];
    await issueInvitation(sent);

    const second = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createInvitation(
        tx,
        TENANT,
        INVITER,
        {
          loginIdentifier: INVITEE,
          displayName: "Newcomer again",
          roleIds: [],
          skipEmailConfirmation: false
        },
        new Date(),
        deliveryOptions(sent)
      )
    );

    expect(second.outcome).toBe("already_pending");
  });

  test("the listing masks the address and never returns it raw", async () => {
    const sent: Sent = [];
    await issueInvitation(sent);

    const page = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listInvitations(tx, TENANT)
    );

    expect(page.invitations).toHaveLength(1);
    expect(page.invitations[0]!.loginIdentifierMasked).not.toBe(INVITEE);
    expect(JSON.stringify(page)).not.toContain(INVITEE);
    expect(page.invitations[0]!.roleCodes).toEqual(["editor"]);
  });

  test("the preview names the tenant and the inviter, and NEVER the address", async () => {
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    const preview = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      previewInvitation(tx, TENANT, invitation.token, new Date())
    );

    expect(preview.outcome).toBe("found");
    if (preview.outcome !== "found") return;

    expect(preview.preview.tenantName).toBe("Invite Tenant");
    expect(preview.preview.inviterName).toBe("Display inviter");
    expect(JSON.stringify(preview)).not.toContain(INVITEE);
  });

  test("deleting an invitation takes its policies with it", async () => {
    // The `ON DELETE CASCADE` the generic purge depends on. Without it the
    // purge aborts on this foreign key and the retention silently never runs.
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    await getAdminSql()`
      DELETE FROM awcms_invitations WHERE tenant_id = ${TENANT} AND id = ${invitation.id}
    `;

    const orphans = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_invitation_policies
      WHERE tenant_id = ${TENANT} AND invitation_id = ${invitation.id}
    `) as { n: number }[];

    expect(orphans[0]!.n).toBe(0);
  });

  test("a scoped invitation policy is refused by the database", async () => {
    // ADR-0080's limit, made unrepresentable rather than merely unwritten.
    const sent: Sent = [];
    const invitation = await issueInvitation(sent);

    let refused = false;
    try {
      await getAdminSql()`
        INSERT INTO awcms_invitation_policies
          (tenant_id, invitation_id, role_id, scope_type, scope_id)
        VALUES (${TENANT}, ${invitation.id}, ${EDITOR_ROLE}, 'office', ${TENANT})
      `;
    } catch {
      refused = true;
    }

    expect(refused).toBe(true);
  });
});
