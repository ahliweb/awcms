import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { disabledResponse } from "../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../modules/social-publishing/domain/social-publishing-constants";
import { socialAdapterRegistry } from "../../../../modules/social-publishing/infrastructure/social-adapter-registry";

/**
 * `GET /api/v1/social-publishing/providers` (Issue #1145, ADR-0157 section 3) —
 * the providers that have a publish adapter in THIS deployment and what each
 * adapter's capability map can carry: content variants, caption ceiling, image
 * types and size. The map is a CEILING and not a grant: an account still needs a
 * granted `publish` capability row with evidence (see `channel_accounts`).
 *
 * Empty until a connector (#1146 to #1151) registers an adapter, which is the
 * fail-closed state: a provider with no adapter cannot publish. Nothing here is
 * tenant data and nothing is a credential.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsRead,
  handler: async () => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok({
      items: socialAdapterRegistry.list().map((adapter) => ({
        provider: adapter.provider,
        capabilities: {
          variants: [...adapter.capabilities.variants],
          maxCaptionLength: adapter.capabilities.maxCaptionLength,
          imageMimeTypes: [...adapter.capabilities.imageMimeTypes],
          maxImageBytes: adapter.capabilities.maxImageBytes
        }
      }))
    });
  }
});
