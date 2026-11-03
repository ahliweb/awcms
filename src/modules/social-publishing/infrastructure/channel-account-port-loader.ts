/**
 * The ONE place `social_publishing` reaches `channel_accounts` for the
 * ENQUEUE-side question "may this account publish now?" (Issue #1145, ADR-0011,
 * `capabilities.consumes` in `module.ts`). A lazy import: `application/**`
 * depends on the port TYPE and asks this function for the implementation; it
 * never imports `channel_accounts` itself.
 *
 * This loads the publisher-resolution adapter only, which holds no secret and
 * never imports the secret store. The credential adapter is composed only by the
 * dispatcher's composition root (`scripts/social-publishing-dispatch.ts`), so a
 * route or a job that only enqueues is never handed the key ring.
 */
import type { ChannelPublisherPort } from "../../_shared/ports/channel-account-port";

export async function loadChannelPublisherPort(): Promise<ChannelPublisherPort> {
  const { channelAccountPortAdapter } =
    await import("../../channel-accounts/application/channel-account-port-adapter");

  return channelAccountPortAdapter;
}
