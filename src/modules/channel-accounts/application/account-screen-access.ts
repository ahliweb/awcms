/**
 * What the channel-account DETAIL screen may show and offer one caller
 * (Issue #1154, ADR-0148 UP-08).
 *
 * The decisions used to sit in the `.astro` frontmatter, where only a source-text
 * test could reach them. They are here so a real database can answer the
 * questions that matter: is another tenant's id the same neutral answer as an
 * unknown one, does an account assigned to somebody else stay invisible, and does
 * a person holding ONE of the two account permissions get that action and not
 * the other.
 *
 * Every rule is the endpoints' own function (`loadAuthorizedAccount`,
 * `filterVisibleConnections`, `mayRevokeConnection`), so the screen can never be
 * more generous than the endpoint behind the button. The endpoint stays the
 * authority; this only decides what to show.
 */
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import { holdsTenantWidePermissionKey } from "../../identity-access/application/auth-context";
import type { AccessRequest } from "../../identity-access/domain/access-control";
import {
  listConnectionAccountBindings,
  toPublicAccount,
  type AccountView
} from "./account-directory";
import {
  canSeeAllAccounts,
  filterVisibleConnections,
  loadAuthorizedAccount,
  mayRevokeConnection
} from "./channel-accounts-route-support";
import { fetchConnection, type ConnectionView } from "./connection-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../domain/channel-accounts-constants";

export type AccountScreenContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

/** The screen's own second decision (`loadAdminScreen`'s `can`): the full chokepoint. */
export type ScreenCan = (request: AccessRequest) => Promise<boolean>;

export type AccountDetailAccess =
  | { visible: false }
  | {
      visible: true;
      account: AccountView;
      /** `null` when there is none, or when the caller may not see it (parity with `GET /connections`). */
      connection: ConnectionView | null;
      canDisconnect: boolean;
      canReplaceCredential: boolean;
      /** The caller's role holds `credentials.manage` but the form is withheld (MFA not enrolled, or a policy). */
      credentialFormWithheld: boolean;
      canRevokeConnection: boolean;
      /** Every account bound to the connection the caller may revoke (an UPPER bound of what is still connected). */
      connectionAccountCount: number;
    };

const asRequest = (guard: {
  moduleKey: string;
  activityCode: string;
  action: string;
}): AccessRequest => guard as AccessRequest;

export async function resolveAccountDetailAccess(
  context: AccountScreenContext,
  accountId: string,
  can: ScreenCan,
  options: {
    /** The guards the screen asserts (spelled out in the page so the coverage gate sees them); a test holds them equal to `CHANNEL_ACCOUNTS_GUARDS`. */
    guards?: Pick<
      typeof CHANNEL_ACCOUNTS_GUARDS,
      "read" | "disconnect" | "manageCredentials"
    >;
  }
): Promise<AccountDetailAccess> {
  const G = options.guards ?? CHANNEL_ACCOUNTS_GUARDS;
  // The routes' own visibility rule (assignment gate and business scope): an
  // account the caller may not see is the same answer as an unknown id or
  // another tenant's id.
  const loaded = await loadAuthorizedAccount(context, accountId, G.read);

  if ("denied" in loaded) return { visible: false };

  const account = toPublicAccount(loaded.account);
  // Sequential: `tx` is one connection.
  const mayRevoke = await can(asRequest(G.disconnect));
  const mayWriteCredential = await can(asRequest(G.manageCredentials));
  // Two SEPARATE authorities: a person may hold `credentials.manage` without
  // `accounts.revoke` (and the reverse), and each action needs `owner` over THIS
  // account under its own guard.
  const ownsDisconnect =
    mayRevoke &&
    !(
      "denied" in
      (await loadAuthorizedAccount(context, account.id, G.disconnect, "owner"))
    );
  const ownsCredential =
    mayWriteCredential &&
    !(
      "denied" in
      (await loadAuthorizedAccount(
        context,
        account.id,
        G.manageCredentials,
        "owner"
      ))
    );

  let connection: ConnectionView | null = null;

  if (account.connectionId !== null) {
    const fetched = await fetchConnection(
      context.tx,
      context.tenantId,
      account.connectionId
    );

    connection =
      fetched &&
      (await filterVisibleConnections(context, G.read, [fetched], null))
        .length > 0
        ? fetched
        : null;
  }

  let canRevokeConnection = false;
  let connectionAccountCount = 0;

  if (connection !== null && mayRevoke && connection.grantState !== "revoked") {
    canRevokeConnection = await mayRevokeConnection(
      context,
      G.disconnect,
      connection
    );

    if (canRevokeConnection) {
      connectionAccountCount = (
        await listConnectionAccountBindings(
          context.tx,
          context.tenantId,
          {
            tenantUserId: context.auth.context.tenantUserId,
            bypass: await canSeeAllAccounts(context)
          },
          "viewer",
          { connectionId: connection.id, provider: null }
        )
      ).length;
    }
  }

  // Only to EXPLAIN a withheld form (it never grants anything): does the role
  // hold the key at all? Asked of the grants themselves, because `can` answers
  // false for "not granted" and for "granted but MFA not enrolled" alike.
  const holdsCredentialKey = await holdsTenantWidePermissionKey(
    context.tx,
    context.tenantId,
    context.auth.context.tenantUserId,
    `${G.manageCredentials.moduleKey}.${G.manageCredentials.activityCode}.${G.manageCredentials.action}`
  );
  const credentialStatusOk =
    account.status === "pending" ||
    account.status === "connected" ||
    account.status === "degraded";
  const credentialApplies = account.authMode !== "oauth2" && credentialStatusOk;
  const canReplaceCredential = ownsCredential && credentialApplies;

  return {
    visible: true,
    account,
    connection,
    canDisconnect: ownsDisconnect && account.status !== "revoked",
    canReplaceCredential,
    credentialFormWithheld:
      holdsCredentialKey &&
      credentialApplies &&
      !canReplaceCredential &&
      !mayWriteCredential,
    canRevokeConnection,
    connectionAccountCount
  };
}
