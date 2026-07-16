import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { fetchActiveEmailTemplate } from "../../../../../../modules/email/application/email-template-directory";
import { buildSyntheticSampleVariables } from "../../../../../../modules/email/domain/email-template-preview";
import { renderEmailTemplate } from "../../../../../../modules/email/domain/email-template-render";

const READ_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "read" as const
};

/**
 * `POST /api/v1/email/templates/{id}/preview` — renders a template for
 * admin preview. Never touches `awcms_email_messages`/the queue and
 * never accepts a real recipient address. Default variables are synthetic
 * sample data (`buildSyntheticSampleVariables`); an optional
 * `{ locale?, variables? }` body can override the locale and/or supply
 * sample values — `variables` still passes through the same category
 * allowlist as a real send, so a caller cannot inject an arbitrary
 * unlisted token even in preview.
 */
export const POST: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const templateId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!templateId) {
    return fail(400, "VALIDATION_ERROR", "Template id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<{
    locale?: unknown;
    variables?: unknown;
  }>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;

  const locale =
    typeof body?.locale === "string" && body.locale.trim().length > 0
      ? body.locale.trim()
      : "en";

  const overrideVariables =
    body?.variables && typeof body.variables === "object"
      ? (body.variables as Record<string, unknown>)
      : {};

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const template = await fetchActiveEmailTemplate(tx, tenantId, templateId);

    if (!template) {
      return fail(404, "RESOURCE_NOT_FOUND", "Email template not found.");
    }

    const sampleVariables = {
      ...buildSyntheticSampleVariables(template.templateKey),
      ...Object.fromEntries(
        Object.entries(overrideVariables).map(([key, value]) => [
          key,
          String(value)
        ])
      )
    };

    const rendered = renderEmailTemplate(
      {
        subjectTemplate: template.subjectTemplate,
        textBodyTemplate: template.textBodyTemplate,
        htmlBodyTemplate: template.htmlBodyTemplate
      },
      sampleVariables,
      template.templateKey,
      locale
    );

    return ok({ locale, ...rendered });
  });
};
