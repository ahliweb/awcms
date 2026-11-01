/**
 * The provider-specific seam of the OAuth flow (Issue #1140, ADR-0148).
 *
 * `channel_accounts` is provider-NEUTRAL: it owns the state nonce, the PKCE
 * pair, the redirect URI, the grant record and the secret handling. What it
 * cannot know is how one provider spells its authorisation URL, so that single
 * pure function is the adapter's. It is the ONLY thing a provider connector
 * (issues #1143, #1146-#1151) has to supply for a connection to be STARTED; the
 * token exchange and refresh are provider I/O and run outside any request
 * transaction in the connector's own job (ADR-0148 I10), against the durable
 * hand-off the callback leaves (`pending_code_secret_id`).
 *
 * No adapter is registered by this issue. Starting a flow for a provider with
 * none is refused (`PROVIDER_ADAPTER_UNAVAILABLE`), which is the fail-closed
 * default: "the provider supports OAuth" is not a claim this module can make on
 * a connector's behalf.
 */
export interface ChannelOAuthAdapter {
  /** The matrix provider key this adapter serves. */
  readonly provider: string;
  /** Whether the provider's authorisation endpoint offers PKCE. When `false` no verifier is created or stored. */
  readonly supportsPkce: boolean;
  /**
   * The provider's authorisation URL. PURE: no I/O, no secret. `redirectUri` is
   * this deployment's own fixed callback; the adapter must not substitute it.
   */
  buildAuthorizationUrl(input: {
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
    scopes: readonly string[];
  }): string;
}

const adapters = new Map<string, ChannelOAuthAdapter>();

export function registerChannelOAuthAdapter(
  adapter: ChannelOAuthAdapter
): void {
  adapters.set(adapter.provider, adapter);
}

export function getChannelOAuthAdapter(
  provider: string
): ChannelOAuthAdapter | null {
  return adapters.get(provider) ?? null;
}

/** Test seam: the registry is process-global state. */
export function clearChannelOAuthAdaptersForTests(): void {
  adapters.clear();
}
