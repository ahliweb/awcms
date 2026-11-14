/**
 * What the three `/admin/website-engagement` screens read, as functions (Issue
 * #1153, ADR-0155 section 8, ADR-0149).
 *
 * The screens read through the SAME directory functions the admin API routes
 * call (`listSources`, `listSubmissions`, `fetchSubmission`), so a screen shows
 * exactly what the API would show this caller: MASKED contact details only (no
 * function in this file touches a ciphertext or a key ring), no token and no
 * token hash (only the six-character prefix), tenant-scoped by the caller's own
 * transaction and RLS. The chain lives here, not inline in `.astro` frontmatter,
 * so a behavioural integration test can run the SAME code as a real, restricted
 * viewer instead of matching source text.
 *
 * Authorization of the entry itself stays with `loadAdminScreen`; this runs only
 * after it allowed the page. `can()` is the same chokepoint, once per
 * affordance, so a control the caller may not use is not rendered.
 *
 * There is no business-scope confinement in this module (a source belongs to
 * the tenant, not to an office): the isolation that matters is the tenant, and
 * it is the transaction's.
 */
import {
  fetchSubmission,
  listSubmissions,
  type SubmissionView
} from "./submission-directory";
import { listSources, type SourceView } from "./source-directory";
import { withEffectiveChallenge } from "./route-support";
import { resolveWebsiteEngagementRings } from "../domain/engagement-config";
import {
  isUuid,
  validateListSubmissionsQuery
} from "../domain/source-validation";
import {
  SUBMISSION_KINDS,
  type ChallengeMode,
  type WEBSITE_ENGAGEMENT_GUARDS
} from "../domain/website-engagement-constants";

type Sql = Bun.SQL;

export type EngagementGuard =
  (typeof WEBSITE_ENGAGEMENT_GUARDS)[keyof typeof WEBSITE_ENGAGEMENT_GUARDS];

/** `can()` of `loadAdminScreen`: the chokepoint, one boolean per probe. */
export type EngagementCan = (guard: EngagementGuard) => Promise<boolean>;

/** Two keyset pages of the API's own query: the bound of what the list loads. */
export const LOAD_PAGE_SIZE = 100;
export const LOAD_PAGE_LIMIT = 2;

export type SubmissionListFilters = {
  source?: string | null;
  kind?: string | null;
  status?: string | null;
};

/** The URL filters as the API's own query string; an unknown value is dropped, never an error. */
export function submissionListParams(
  filters: SubmissionListFilters,
  cursor: string | null
): URLSearchParams {
  const params = new URLSearchParams();
  const { source, kind, status } = filters;

  // `validateListSubmissionsQuery` refuses a non-UUID `sourceId`; a hand-edited
  // URL must give an unfiltered page, not a validation failure.
  if (source && /^[0-9a-f-]{36}$/i.test(source)) params.set("sourceId", source);

  if (kind && (SUBMISSION_KINDS as readonly string[]).includes(kind)) {
    params.set("kind", kind);
  }

  if (status === "received" || status === "withdrawn") {
    params.set("status", status);
  }

  params.set("limit", String(LOAD_PAGE_SIZE));

  if (cursor) params.set("cursor", cursor);

  return params;
}

export type SourceOption = { id: string; code: string };

export type SubmissionListData = {
  /** `false` while the key rings are refused on this deployment: intake refuses, reads still work. */
  intakeAvailable: boolean;
  submissions: SubmissionView[];
  more: boolean;
  /** The source filter's options; from `sources.read` when held, else from the rows loaded. */
  sourceOptions: SourceOption[];
  canSeeSources: boolean;
};

export async function loadSubmissionList(input: {
  tx: Sql;
  tenantId: string;
  filters: SubmissionListFilters;
  readSourcesGuard: EngagementGuard;
  can: EngagementCan;
}): Promise<SubmissionListData> {
  const { tx, tenantId, filters, can } = input;
  // One awaited query at a time: `tx` is one connection.
  const submissions: SubmissionView[] = [];
  let cursor: string | null = null;
  let more = false;

  for (let page = 0; page < LOAD_PAGE_LIMIT; page += 1) {
    const validated = validateListSubmissionsQuery(
      submissionListParams(filters, cursor)
    );

    if (!validated.valid) break;

    const result = await listSubmissions(tx, tenantId, validated.value);

    if (!result.ok) break;

    submissions.push(...result.items);

    if (result.nextCursor === null) break;

    cursor = result.nextCursor;
    more = page === LOAD_PAGE_LIMIT - 1;
  }

  const canSeeSources = await can(input.readSourcesGuard);
  const sourceOptions: SourceOption[] = canSeeSources
    ? (await listSources(tx, tenantId)).map(({ id, code }) => ({ id, code }))
    : [
        ...new Map(
          submissions.map((row) => [
            row.sourceId,
            { id: row.sourceId, code: row.sourceCode }
          ])
        ).values()
      ];

  return {
    intakeAvailable: resolveWebsiteEngagementRings().ok,
    submissions,
    more,
    sourceOptions,
    canSeeSources
  };
}

export type SubmissionDetailData =
  | { found: false }
  | { found: true; submission: SubmissionView; canWithdraw: boolean };

export async function loadSubmissionDetail(input: {
  tx: Sql;
  tenantId: string;
  /** Raw path parameter; normalised here so no caller can forget to. */
  submissionId: string | null;
  withdrawGuard: EngagementGuard;
  can: EngagementCan;
}): Promise<SubmissionDetailData> {
  const { tx, tenantId, submissionId, can } = input;

  // A malformed id never reaches the database (22P02 would be a distinct
  // "could not be loaded" state plus a log line per request): it is the same
  // "not found" as an unknown id or another tenant's id.
  if (!isUuid(submissionId)) return { found: false };

  const submission = await fetchSubmission(
    tx,
    tenantId,
    submissionId.toLowerCase()
  );

  if (!submission) return { found: false };

  return {
    found: true,
    submission,
    canWithdraw:
      submission.status === "received" && (await can(input.withdrawGuard))
  };
}

export type SourceRow = SourceView & { challengeEffective: ChallengeMode };

export type SourceListData = {
  intakeAvailable: boolean;
  sources: SourceRow[];
  canManage: boolean;
};

export async function loadSourceList(input: {
  tx: Sql;
  tenantId: string;
  manageGuard: EngagementGuard;
  can: EngagementCan;
}): Promise<SourceListData> {
  const { tx, tenantId, can } = input;
  const sources = (await listSources(tx, tenantId)).map(withEffectiveChallenge);

  return {
    intakeAvailable: resolveWebsiteEngagementRings().ok,
    sources,
    canManage: await can(input.manageGuard)
  };
}
