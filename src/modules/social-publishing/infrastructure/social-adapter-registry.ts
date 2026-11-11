/**
 * The provider-adapter registry (Issue #1145, ADR-0157 section 3).
 *
 * One adapter per provider key, process-local. A provider without an adapter
 * cannot publish (`PROVIDER_ADAPTER_UNAVAILABLE`), which is the fail-closed
 * default.
 *
 * ## Built-in connectors (Issue #1146 onwards)
 *
 * A real connector is not REGISTERED by import order: the default registry
 * answers it from {@link builtInAdapter}, which reads its deployment switch on
 * every call (`SOCIAL_PUBLISHING_FACEBOOK_ENABLED`, default off). So the enqueue
 * path (app process) and the dispatcher (job process) agree without either
 * composition root having to remember to register it, and switching the flag
 * off withdraws the adapter from both at once. Today the only built-in is
 * Facebook Pages. An explicitly registered adapter (tests) takes precedence.
 */
import type { SocialPublishAdapter } from "../domain/social-publish-adapter";
import { isAnchoredPattern } from "../domain/social-publish-post-reference";
import { isSocialPublishingFacebookEnabled } from "../domain/social-publishing-constants";
import { facebookPagesAdapter } from "./facebook-pages-adapter";

const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,31}$/;

export type SocialAdapterRegistry = {
  get(provider: string): SocialPublishAdapter | null;
  list(): SocialPublishAdapter[];
};

const adapters = new Map<string, SocialPublishAdapter>();

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * What every adapter must declare before it can speak for an account. L6 of
 * the #1145 audit: a post id is checked against the adapter's own ANCHORED
 * pattern, and a post URL against its declared hosts; an adapter that cannot
 * say what its ids look like is refused at registration rather than trusted.
 */
function assertAdmissible(adapter: SocialPublishAdapter): void {
  if (!PROVIDER_KEY.test(adapter.provider)) {
    throw new Error("A social publish adapter needs a valid provider key.");
  }

  if (
    !(adapter.externalPostIdPattern instanceof RegExp) ||
    !isAnchoredPattern(adapter.externalPostIdPattern)
  ) {
    throw new Error(
      `The social publish adapter for "${adapter.provider}" needs an anchored externalPostIdPattern (^...$).`
    );
  }

  if (
    !Array.isArray(adapter.postUrlHosts) ||
    adapter.postUrlHosts.some(
      (host) => typeof host !== "string" || !HOSTNAME.test(host)
    )
  ) {
    throw new Error(
      `The social publish adapter for "${adapter.provider}" needs postUrlHosts as lowercase hostnames.`
    );
  }
}

export function registerSocialPublishAdapter(
  adapter: SocialPublishAdapter
): void {
  assertAdmissible(adapter);

  if (adapters.has(adapter.provider)) {
    // A second adapter for the same provider would make "which one speaks for
    // this account" depend on import order.
    throw new Error(
      `A social publish adapter is already registered for provider "${adapter.provider}".`
    );
  }

  adapters.set(adapter.provider, adapter);
}

export function resetSocialPublishAdaptersForTests(): void {
  adapters.clear();
}

/** The connector that ships in this repository for `provider`, when its switch is on. */
export function builtInAdapter(
  provider: string,
  env: NodeJS.ProcessEnv = process.env
): SocialPublishAdapter | null {
  if (provider === "facebook" && isSocialPublishingFacebookEnabled(env)) {
    return facebookPagesAdapter;
  }

  return null;
}

export const socialAdapterRegistry: SocialAdapterRegistry = {
  get: (provider) => adapters.get(provider) ?? builtInAdapter(provider),
  list: () => {
    const listed = [...adapters.values()];
    const facebook = builtInAdapter("facebook");

    if (facebook && !adapters.has("facebook")) listed.push(facebook);

    return listed;
  }
};

// The built-in connectors pass the same admission as a registered adapter.
assertAdmissible(facebookPagesAdapter);

/** A fixed registry, for tests and for a composition root that wants one explicit set. */
export function createSocialAdapterRegistry(
  list: readonly SocialPublishAdapter[]
): SocialAdapterRegistry {
  for (const adapter of list) assertAdmissible(adapter);

  const map = new Map(list.map((adapter) => [adapter.provider, adapter]));

  return {
    get: (provider) => map.get(provider) ?? null,
    list: () => [...map.values()]
  };
}
