/**
 * TEST-ONLY source checks for the social dispatcher (ADR-0157 L8).
 *
 * The real checks (`blog_content`'s `articlePublicationStatusAdapter` and
 * `media_library`'s `mediaPublicationRecheckAdapter`) call SECURITY DEFINER
 * functions (`sql/386`) whose EXECUTE only `awcms_social_dispatch` holds. Tests
 * that drive the dispatcher as another role, and are about something else
 * (queue, leases, retries, accounts), compose this instead: every source still
 * "published", every media object still "eligible". The L8 behaviour itself is
 * tested with the REAL adapters on the real role login
 * (`social-publishing-facebook.integration.test.ts`). Never imported by `src/`.
 */
import type { PublicationSourceChecks } from "../../src/modules/social-publishing/application/social-publish-dispatch";

export const sourcesAlwaysPublishableForTests: PublicationSourceChecks = {
  articles: {
    async checkArticlePublished() {
      return { published: true };
    }
  },
  media: {
    async recheckMediaForPublication() {
      return { eligible: true };
    }
  }
};
