/**
 * The pure half of the Meta enablement preflight (Issue #1298, finding L5 of
 * the independent audit of #1267): which rows would go TERMINAL at their next
 * dispatch the moment the tenant-owned Meta path is switched on, so an operator
 * can fix them (register the WABA parent, record the template approvals) BEFORE
 * enabling, not after an OTP failed.
 *
 * It is the dispatcher's own rule, applied to what is queued now, never a second
 * copy of it: the verdict of each group comes from `decideMetaSend`.
 */
import type { WhatsappPurpose } from "../../_shared/ports/whatsapp-delivery-port";
import {
  decideMetaSend,
  type MetaTemplateCategory,
  type MetaTemplateStatus
} from "./meta-cloud-policy";
import type { WhatsappTemplateDefinition } from "./whatsapp-templates";

export type MetaPreflightNumber = {
  accountId: string;
  /** The WABA id of a LIVE `waba` container parent, or `null` (no parent, a deleted one, or one of another kind). */
  wabaId: string | null;
  /**
   * The dispatcher's OWN verdict for this number (the sender port's
   * `resolveWhatsappSender` classified by `classifySenderUnavailable`), so a
   * parent that is revoked or disabled, or whose business scope does not
   * contain the number's, is reported as what the dispatcher will do with it.
   * Absent means usable (the pure tests that do not exercise the binding).
   */
  sender?:
    { verdict: "usable" } | { verdict: "terminal" | "hold"; reason: string };
};

/** Queued, retry-waiting or in-flight rows of one Meta number, grouped. */
export type MetaPreflightGroup = {
  senderAccountId: string;
  templateKey: string;
  purpose: WhatsappPurpose;
  /** The recipient had written to THIS number inside the last 24 hours. */
  windowOpen: boolean;
  rows: number;
};

export type MetaPreflightApproval = {
  wabaId: string;
  name: string;
  language: string;
  status: MetaTemplateStatus;
  category: MetaTemplateCategory;
};

export type MetaPreflightFinding =
  | {
      kind: "number_unusable";
      accountId: string;
      /** `terminal`: every queued row fails at its next dispatch. `hold`: rows wait (an OTP still expires on its own clock). */
      verdict: "terminal" | "hold";
      reason: string;
      pendingRows: number;
      pendingSecurityRows: number;
    }
  | {
      kind: "number_without_waba";
      accountId: string;
      /** Rows queued on this number: every one fails terminally (`SENDER_BINDING_CHANGED` / an invalid WABA binding). */
      pendingRows: number;
      pendingSecurityRows: number;
    }
  | {
      kind: "pending_blocked";
      accountId: string;
      wabaId: string;
      reason:
        | "TEMPLATE_NOT_APPROVED"
        | "OUTSIDE_SERVICE_WINDOW"
        | "TEMPLATE_UNREGISTERED";
      templateKey: string;
      purpose: WhatsappPurpose;
      /** The template identity Meta must have approved on this WABA, when the registration names one. */
      providerTemplate: { name: string; language: string } | null;
      rows: number;
    };

export type MetaPreflightReport = {
  numbersChecked: number;
  pendingRows: number;
  findings: MetaPreflightFinding[];
  /** Rows that will fail terminally at their next dispatch. */
  blockedRows: number;
  /** Of those, `security` rows (an OTP that will not arrive). */
  blockedSecurityRows: number;
};

const approvalKey = (wabaId: string, name: string, language: string) =>
  `${wabaId}\u0000${name}\u0000${language}`;

export function evaluateMetaEnablement(input: {
  numbers: readonly MetaPreflightNumber[];
  groups: readonly MetaPreflightGroup[];
  approvals: readonly MetaPreflightApproval[];
  lookupTemplate: (key: string) => WhatsappTemplateDefinition | undefined;
}): MetaPreflightReport {
  const byNumber = new Map(
    input.numbers.map((number) => [number.accountId, number])
  );
  const approvals = new Map(
    input.approvals.map((approval) => [
      approvalKey(approval.wabaId, approval.name, approval.language),
      { status: approval.status, category: approval.category }
    ])
  );
  const findings: MetaPreflightFinding[] = [];
  let pendingRows = 0;
  let blockedRows = 0;
  let blockedSecurityRows = 0;
  const unbound = new Map<string, { rows: number; security: number }>();
  const unusable = new Map<string, { rows: number; security: number }>();

  for (const group of input.groups) {
    const number = byNumber.get(group.senderAccountId);

    // Not a Meta number of this tenant (a StarSender device, the deployment
    // sender, a disabled account): outside this preflight.
    if (!number) continue;

    pendingRows += group.rows;

    if (number.wabaId === null) {
      const entry = unbound.get(number.accountId) ?? { rows: 0, security: 0 };

      entry.rows += group.rows;
      if (group.purpose === "security") entry.security += group.rows;
      unbound.set(number.accountId, entry);
      blockedRows += group.rows;
      if (group.purpose === "security") blockedSecurityRows += group.rows;
      continue;
    }

    if (number.sender && number.sender.verdict !== "usable") {
      const entry = unusable.get(number.accountId) ?? { rows: 0, security: 0 };

      entry.rows += group.rows;
      if (group.purpose === "security") entry.security += group.rows;
      unusable.set(number.accountId, entry);

      // A hold is not a failure: the rows wait, so they are not "blocked".
      if (number.sender.verdict === "terminal") {
        blockedRows += group.rows;
        if (group.purpose === "security") blockedSecurityRows += group.rows;
      }

      continue;
    }

    const template = input.lookupTemplate(group.templateKey);
    let reason:
      | "TEMPLATE_NOT_APPROVED"
      | "OUTSIDE_SERVICE_WINDOW"
      | "TEMPLATE_UNREGISTERED"
      | null = null;

    if (!template) {
      reason = "TEMPLATE_UNREGISTERED";
    } else {
      const decision = decideMetaSend({
        purpose: group.purpose,
        hasProviderTemplate: Boolean(template.providerTemplate),
        approval: template.providerTemplate
          ? (approvals.get(
              approvalKey(
                number.wabaId,
                template.providerTemplate.name,
                template.providerTemplate.language
              )
            ) ?? null)
          : null,
        windowOpen: group.windowOpen
      });

      if (!decision.ok) reason = decision.reason;
    }

    if (reason === null) continue;

    blockedRows += group.rows;
    if (group.purpose === "security") blockedSecurityRows += group.rows;
    findings.push({
      kind: "pending_blocked",
      accountId: number.accountId,
      wabaId: number.wabaId,
      reason,
      templateKey: group.templateKey,
      purpose: group.purpose,
      providerTemplate: template?.providerTemplate ?? null,
      rows: group.rows
    });
  }

  // A number with no WABA parent is reported even with an empty queue: it
  // fails the day anything is queued for it.
  for (const number of input.numbers) {
    if (number.wabaId !== null) continue;

    const entry = unbound.get(number.accountId);

    findings.unshift({
      kind: "number_without_waba",
      accountId: number.accountId,
      pendingRows: entry?.rows ?? 0,
      pendingSecurityRows: entry?.security ?? 0
    });
  }

  // A bound number the dispatcher cannot use is reported even with an empty
  // queue, for the same reason.
  for (const number of input.numbers) {
    if (number.wabaId === null) continue;
    if (!number.sender || number.sender.verdict === "usable") continue;

    const entry = unusable.get(number.accountId);

    findings.unshift({
      kind: "number_unusable",
      accountId: number.accountId,
      verdict: number.sender.verdict,
      reason: number.sender.reason,
      pendingRows: entry?.rows ?? 0,
      pendingSecurityRows: entry?.security ?? 0
    });
  }

  return {
    numbersChecked: input.numbers.length,
    pendingRows,
    findings,
    blockedRows,
    blockedSecurityRows
  };
}
