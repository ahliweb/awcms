/**
 * The provider-adapter registry (Issue #1145, ADR-0157 section 3).
 *
 * One adapter per provider key, process-local, EMPTY in this slice: every real
 * provider (#1146 to #1151) registers its own adapter here when it is admitted,
 * and until it does a provider cannot publish (`PROVIDER_ADAPTER_UNAVAILABLE`),
 * which is the fail-closed default. Nothing in this module registers an adapter
 * on its own. The only adapter written in this slice is an in-memory fake that
 * tests register explicitly.
 */
import type { SocialPublishAdapter } from "../domain/social-publish-adapter";

const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,31}$/;

export type SocialAdapterRegistry = {
  get(provider: string): SocialPublishAdapter | null;
  list(): SocialPublishAdapter[];
};

const adapters = new Map<string, SocialPublishAdapter>();

export function registerSocialPublishAdapter(
  adapter: SocialPublishAdapter
): void {
  if (!PROVIDER_KEY.test(adapter.provider)) {
    throw new Error("A social publish adapter needs a valid provider key.");
  }

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

export const socialAdapterRegistry: SocialAdapterRegistry = {
  get: (provider) => adapters.get(provider) ?? null,
  list: () => [...adapters.values()]
};

/** A fixed registry, for tests and for a composition root that wants one explicit set. */
export function createSocialAdapterRegistry(
  list: readonly SocialPublishAdapter[]
): SocialAdapterRegistry {
  const map = new Map(list.map((adapter) => [adapter.provider, adapter]));

  return {
    get: (provider) => map.get(provider) ?? null,
    list: () => [...map.values()]
  };
}
