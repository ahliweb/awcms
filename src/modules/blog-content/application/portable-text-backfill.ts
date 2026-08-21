import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  contentBlocksToPortableText,
  portableTextToPlainText,
  readLegacyBlocks
} from "../domain/portable-text-conversion";

/**
 * One-shot conversion of every legacy `content_json.blocks` body into
 * `body_portable_text` (ADR-0100, Issue #588).
 *
 * ## Why this is a script and not migration DML
 *
 * `awcms_blog_posts` is `FORCE ROW LEVEL SECURITY`. DML inside a migration
 * against a FORCE RLS table runs fine on an empty CI database — there are no
 * rows for a policy to refuse — and then fails or silently touches nothing in
 * production, where `app.current_tenant_id` is not set for the migration
 * session. So `sql/134` adds the columns and stops, and the rows are converted
 * here, per tenant, inside `withTenantOrThrow`.
 *
 * ## Why every statement still carries an explicit `tenant_id`
 *
 * Belt and braces, and the repo has been bitten before: a per-tenant script
 * that leans on RLS alone converts whatever the GUC happens to say, which is
 * the wrong tenant the first time a caller loops without resetting it.
 *
 * ## Idempotent, and re-runnable after a partial failure
 *
 * The predicate is `body_portable_text = '[]'::jsonb` — a row already
 * converted is not selected again. Combined with the converter being
 * DETERMINISTIC (position-derived keys, no clock, no randomness), a second run
 * after a crash converts only what the first one missed and rewrites nothing.
 *
 * ## What it deliberately does NOT do
 *
 * It does not touch `content_json`. The compatibility projection into
 * `content_json.blocks` is what the WRITE PATH maintains from now on; the
 * legacy `blocks` already sitting in those rows is a correct projection of the
 * body being converted, so rewriting it here would be a no-op with a risk
 * attached — every row's envelope rewritten, including the `awcmsAstro`
 * sidecar it must not disturb.
 */

export type PortableTextBackfillOptions = {
  /** `false` (the default) counts and reports; `true` writes. */
  commit?: boolean;
  batchLimit?: number;
  correlationId?: string;
};

export type PortableTextBackfillResult = {
  scanned: number;
  converted: number;
  /** Rows whose `content_json` held no usable `blocks` array — nothing to convert. */
  skippedNoBlocks: number;
  /** `true` when this run filled its batch; the remainder is finished on the next run. */
  partial: boolean;
};

export const PORTABLE_TEXT_BACKFILL_BATCH_LIMIT = 500;

type LegacyRow = {
  id: string;
  content_json: unknown;
};

const TABLES = ["awcms_blog_posts", "awcms_blog_pages"] as const;

export type PortableTextBackfillTable = (typeof TABLES)[number];

async function backfillOneTable(
  tx: Bun.SQL,
  tenantId: string,
  table: PortableTextBackfillTable,
  commit: boolean,
  batchLimit: number
): Promise<PortableTextBackfillResult> {
  // Table name is from the module-local `TABLES` literal, never from input —
  // it cannot be a bound parameter, so the only safe source is a constant.
  const rows = (await (table === "awcms_blog_posts"
    ? tx`
        SELECT id, content_json
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId}
          AND body_portable_text = '[]'::jsonb
        ORDER BY created_at ASC
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      `
    : tx`
        SELECT id, content_json
        FROM awcms_blog_pages
        WHERE tenant_id = ${tenantId}
          AND body_portable_text = '[]'::jsonb
        ORDER BY created_at ASC
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      `)) as LegacyRow[];

  let converted = 0;
  let skippedNoBlocks = 0;

  for (const row of rows) {
    const blocks = readLegacyBlocks(row.content_json);

    if (blocks === null || blocks.length === 0) {
      skippedNoBlocks += 1;
      continue;
    }

    const document = contentBlocksToPortableText(blocks);
    const plainText = portableTextToPlainText(document);

    if (commit) {
      // `content_text` is rewritten from the converted body in the same
      // statement. Leaving the client-supplied value would preserve exactly the
      // drift ADR-0100 §3 exists to end — a search index that believes text
      // nobody can find in the article.
      if (table === "awcms_blog_posts") {
        await tx`
          UPDATE awcms_blog_posts
          SET body_portable_text = ${document}::jsonb,
              content_text = ${plainText}
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
        `;
      } else {
        await tx`
          UPDATE awcms_blog_pages
          SET body_portable_text = ${document}::jsonb,
              content_text = ${plainText}
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
        `;
      }
    }

    converted += 1;
  }

  return {
    scanned: rows.length,
    converted,
    skippedNoBlocks,
    partial: rows.length === batchLimit
  };
}

/** Converts one tenant's posts and pages. */
export async function backfillPortableTextForTenant(
  sql: Bun.SQL,
  tenantId: string,
  options: PortableTextBackfillOptions = {}
): Promise<PortableTextBackfillResult> {
  const commit = options.commit ?? false;
  const batchLimit = options.batchLimit ?? PORTABLE_TEXT_BACKFILL_BATCH_LIMIT;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const totals: PortableTextBackfillResult = {
        scanned: 0,
        converted: 0,
        skippedNoBlocks: 0,
        partial: false
      };

      for (const table of TABLES) {
        const result = await backfillOneTable(
          tx,
          tenantId,
          table,
          commit,
          batchLimit
        );

        totals.scanned += result.scanned;
        totals.converted += result.converted;
        totals.skippedNoBlocks += result.skippedNoBlocks;
        totals.partial = totals.partial || result.partial;
      }

      log("info", "blog-content.portable-text.backfill", {
        correlationId: options.correlationId,
        tenantId,
        moduleKey: "blog_content",
        commit,
        ...totals
      });

      return totals;
    },
    { workClass: "maintenance" }
  );
}
