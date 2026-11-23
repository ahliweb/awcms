/**
 * Pure model behind the `/admin/website-engagement/sources` form (Issue #1477,
 * ADR-0155 sections 2, 3 and 8): what to send for create and edit, and the
 * one-time token holder. No DOM, no network, so `tests/` can drive it directly.
 *
 * ## The token holder
 *
 * A source token is returned by the create and rotate endpoints exactly once.
 * {@link createTokenHolder} is the ONLY place the page keeps it, and it keeps it
 * only as the text of one output element, through a sink the page supplies:
 *
 * - it is never written to `localStorage`, `sessionStorage`, a cookie, the URL,
 *   `console` or an attribute (the contract test pins each of those);
 * - {@link TokenHolder.clear} removes it from the sink, and the page calls that
 *   on dismissal, on `pagehide` and when the page is restored from the bfcache,
 *   so a token never survives the operator leaving the panel;
 * - a second `show` replaces the first (a rotation never leaves two tokens up).
 */
import type {
  ChallengeMode,
  SubmissionKind
} from "../../modules/website-engagement/domain/website-engagement-constants";

export type SourceFormValues = {
  code: string;
  name: string;
  consentCopyVersion: string;
  challengeMode: ChallengeMode;
  acceptedKinds: SubmissionKind[];
  domainIds: string[];
};

/** The non-secret fields the edit button carries (never a token, prefix or hash). */
export type SourceEditSnapshot = Omit<SourceFormValues, "code"> & {
  id: string;
  code: string;
  status: "active" | "paused" | "revoked";
};

export type CreateBody = SourceFormValues;

export type UpdateBody = Partial<
  Omit<SourceFormValues, "code"> & { status: "active" | "paused" }
>;

const sorted = (values: readonly string[]): string[] => [...values].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** The create request: every field, nothing else (the API refuses unknown keys). */
export function buildCreateBody(values: SourceFormValues): CreateBody {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    consentCopyVersion: values.consentCopyVersion.trim(),
    challengeMode: values.challengeMode,
    acceptedKinds: sorted(values.acceptedKinds) as SubmissionKind[],
    domainIds: sorted(values.domainIds)
  };
}

/**
 * The edit request: ONLY what changed. An empty result means "nothing to
 * change" and nothing is sent (the API would answer 422).
 */
export function buildUpdateBody(
  before: SourceEditSnapshot,
  after: Omit<SourceFormValues, "code">
): UpdateBody {
  const body: UpdateBody = {};

  if (after.name.trim() !== before.name) body.name = after.name.trim();

  if (after.consentCopyVersion.trim() !== before.consentCopyVersion) {
    body.consentCopyVersion = after.consentCopyVersion.trim();
  }

  if (after.challengeMode !== before.challengeMode) {
    body.challengeMode = after.challengeMode;
  }

  if (!sameSet(after.acceptedKinds, before.acceptedKinds)) {
    body.acceptedKinds = sorted(after.acceptedKinds) as SubmissionKind[];
  }

  if (!sameSet(after.domainIds, before.domainIds)) {
    body.domainIds = sorted(after.domainIds);
  }

  return body;
}

/** True when the request switches the third-party challenge OFF (needs an Idempotency-Key and a confirmation). */
export function disablesChallenge(
  body: { challengeMode?: ChallengeMode },
  before?: { challengeMode: ChallengeMode }
): boolean {
  return (
    body.challengeMode === "none" &&
    (before === undefined || before.challengeMode !== "none")
  );
}

export type TokenOutcome =
  /** The one and only time the token is available. */
  | { kind: "token"; token: string }
  /** The request succeeded but the token was delivered earlier (an idempotent replay): rotate again for a new one. */
  | { kind: "replayed" }
  | { kind: "none" };

/** Reads a create/rotate response body; anything unexpected is `none`, never a guess. */
export function readTokenOutcome(data: unknown): TokenOutcome {
  if (typeof data !== "object" || data === null) return { kind: "none" };

  const record = data as { revealed?: unknown; token?: unknown };

  if (
    record.revealed === true &&
    typeof record.token === "string" &&
    record.token.length > 0
  ) {
    return { kind: "token", token: record.token };
  }

  return record.revealed === false ? { kind: "replayed" } : { kind: "none" };
}

/** Where the token's text lives; the page binds it to one element. */
export type TokenSink = {
  show(text: string): void;
  clear(): void;
};

export type TokenHolder = {
  show(token: string): void;
  clear(): void;
  isHeld(): boolean;
};

export function createTokenHolder(sink: TokenSink): TokenHolder {
  let held = false;

  return {
    show(token) {
      sink.show(token);
      held = true;
    },
    clear() {
      // Clear unconditionally: the sink is the source of truth for what the
      // DOM shows, and clearing an empty sink costs nothing.
      sink.clear();
      held = false;
    },
    isHeld: () => held
  };
}
