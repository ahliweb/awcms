/**
 * The ONE place `whatsapp_delivery` reaches `channel_accounts` (Issue #1141,
 * ADR-0011, `capabilities.consumes` in `module.ts`). A lazy import, so the
 * channel module is loaded only when a message actually names a tenant-owned
 * sender (or a policy points at one): the common path, a deployment-sender
 * message, never touches it, which is what keeps today's behaviour byte for
 * byte. `application/**` depends on the port TYPE and asks this function for the
 * implementation; it never imports `channel_accounts` itself.
 *
 * This loads the SENDER-RESOLUTION adapter only, which holds no secret and never
 * imports the secret store. The credential adapter is composed by the
 * dispatcher's composition root (`scripts/whatsapp-dispatch.ts`), so a job that
 * only enqueues is never handed the key ring.
 */
import type { ChannelAccountPort } from "../../_shared/ports/channel-account-port";

export async function loadChannelAccountPort(): Promise<ChannelAccountPort> {
  const { channelAccountPortAdapter } =
    await import("../../channel-accounts/application/channel-account-port-adapter");

  return channelAccountPortAdapter;
}
