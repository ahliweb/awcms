/**
 * Deployment switches of UNOFFICIAL provider adapters (Issue #1142, ADR-0148 I6
 * and section 7). Pure, no I/O, shared by the module that sends
 * (`whatsapp_delivery`) and the one that connects accounts (`channel_accounts`),
 * so the two cannot disagree about whether the adapter exists on this
 * deployment.
 *
 * Off by default, like every provider-facing capability of ADR-0148: only the
 * exact string `true` enables it. Turning it on is the operator's decision and is
 * still not enough to send: a device must be attested, the tenant must hold an
 * active risk acknowledgement of the current approved text, and the capability
 * needs evidence.
 */
export function isStarsenderAdapterEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.WHATSAPP_STARSENDER_ENABLED === "true";
}
