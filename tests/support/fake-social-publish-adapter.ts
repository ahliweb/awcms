/**
 * The ONE provider adapter written for Issue #1145 (ADR-0157): an in-memory fake
 * for TESTS ONLY. It makes no network call, is never registered by application
 * code, and lives under `tests/` so no module can import it. It records every
 * request it receives (including the in-memory credential, so a test can prove
 * each account was published with ITS OWN credential and tenant) and lets a test
 * script the outcome per call.
 */
import type {
  SocialPublishAdapter,
  SocialPublishCapabilities,
  SocialPublishOutcome,
  SocialPublishRequest
} from "../../src/modules/social-publishing/domain/social-publish-adapter";

export type FakeCall = {
  tenantId: string;
  accountId: string;
  provider: string;
  externalId: string;
  credential: string;
  variant: string;
  caption: string;
  linkUrl: string | null;
  idempotencyKey: string;
  hasHttp: boolean;
};

export type FakeBehavior = (
  request: SocialPublishRequest,
  callNumber: number
) => SocialPublishOutcome | Promise<SocialPublishOutcome>;

export const FULL_CAPABILITIES: SocialPublishCapabilities = {
  variants: ["text", "image"],
  maxCaptionLength: 2200,
  imageMimeTypes: ["image/jpeg", "image/png"],
  maxImageBytes: 8 * 1024 * 1024
};

export const TEXT_ONLY_CAPABILITIES: SocialPublishCapabilities = {
  variants: ["text"],
  maxCaptionLength: 280,
  imageMimeTypes: [],
  maxImageBytes: 0
};

export type FakeSocialAdapter = SocialPublishAdapter & {
  calls: FakeCall[];
  setBehavior(behavior: FakeBehavior): void;
};

let postSequence = 0;

export function createFakeSocialAdapter(
  provider: string,
  capabilities: SocialPublishCapabilities = FULL_CAPABILITIES,
  initial?: FakeBehavior
): FakeSocialAdapter {
  const calls: FakeCall[] = [];
  let behavior: FakeBehavior =
    initial ??
    (() => {
      postSequence += 1;

      return {
        outcome: "published",
        externalPostId: `post-${provider}-${postSequence}`,
        externalPostUrl: `https://${provider}.example/p/${postSequence}`
      };
    });

  return {
    provider,
    capabilities,
    errorCodes: [
      "POLICY_BLOCK",
      "UPSTREAM_5XX",
      "RATE_LIMITED",
      "NEEDS_REAUTH"
    ],
    calls,
    setBehavior(next) {
      behavior = next;
    },
    async publish(request) {
      calls.push({
        tenantId: request.tenantId,
        accountId: request.accountId,
        provider: request.provider,
        externalId: request.externalId,
        credential: request.credential,
        variant: request.content.variant,
        caption: request.content.caption,
        linkUrl: request.content.linkUrl,
        idempotencyKey: request.idempotencyKey,
        hasHttp: typeof request.http === "function"
      });

      return behavior(request, calls.length);
    }
  };
}
