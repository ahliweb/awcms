/**
 * Deployment switch for `omnichannel_inbox` (Issue #1164, ADR-0160 `Accepted`).
 *
 * Off by default at three levels: this switch, the module registry
 * (`experimental`) and the tenant's own module toggle. With the switch off every
 * route answers `404`, the projector consumer does nothing and the SLA job exits
 * without touching a tenant. Turning it on later starts an empty projection: an
 * administrator rebuilds it from the event log (`POST .../projection/rebuild`).
 */
export function isOmnichannelInboxEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.OMNICHANNEL_INBOX_ENABLED === "true";
}
