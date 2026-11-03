/**
 * Provider risk acknowledgements (Issue #1142, ADR-0148 section 4 and 7).
 *
 * A provider whose interface is **unofficial** (StarSender is the one recorded
 * exception to "official interfaces only", ADR-0148 I6) cannot be used until an
 * accountable person has read the risk and said so. The acknowledgement is a
 * record, not a checkbox in a form: WHICH provider, WHO, WHEN, and WHICH version
 * of the text (with a hash of the exact text shown), and it is revocable.
 *
 * ## The text is a HUMAN decision, so the code ships it unapproved
 *
 * ADR-0148 and Issue #1142 condition (4): the wording must be approved by the
 * business owner (counsel for the DPIA copy). That is not something an agent or a
 * pull request can do. The catalogue therefore ships the StarSender text as a
 * DRAFT with `approval: null`, and {@link resolveRiskAcknowledgement} answers
 * "not approved" for it: **no acknowledgement can be recorded, and so no device
 * can become `connected`, until a reviewed change fills `approval`** (and bumps
 * `textVersion` if the wording changed, which invalidates every earlier
 * acknowledgement: a person agreed to one text, not to its successor).
 *
 * Pure: no I/O.
 */
import { createHash } from "node:crypto";

export const RISK_ACKNOWLEDGEMENT_PROVIDERS = ["starsender"] as const;

export type RiskAcknowledgementProvider =
  (typeof RISK_ACKNOWLEDGEMENT_PROVIDERS)[number];

export function isRiskAcknowledgementProvider(
  value: unknown
): value is RiskAcknowledgementProvider {
  return (
    typeof value === "string" &&
    (RISK_ACKNOWLEDGEMENT_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Who approved the wording, and where that is evidenced. `null` means: nobody has. */
export type RiskTextApproval = {
  approvedBy: string;
  /** ISO date. */
  approvedOn: string;
  /** A reference a reviewer can open (an issue or ADR comment), never a person's contact detail. */
  reference: string;
};

export type RiskAcknowledgementEntry = {
  provider: RiskAcknowledgementProvider;
  textVersion: string;
  text: { en: string; id: string };
  approval: RiskTextApproval | null;
};

export const STARSENDER_RISK_TEXT_VERSION = "starsender-2026-11-draft-1";

/**
 * DRAFT wording, written from the facts in the issue and ADR-0148 and nothing
 * else: it claims no Meta authorisation, no ban-free sending and no delivery
 * status. It is a starting point for the business owner, not an approved text.
 */
const STARSENDER_RISK_TEXT = {
  en: [
    "StarSender is an UNOFFICIAL WhatsApp gateway. It is not an interface authorised or endorsed by WhatsApp or Meta.",
    "Using it may breach WhatsApp's terms of service. Your WhatsApp number can be restricted or banned, and AWCMS cannot prevent or reverse that.",
    "A response of 'success' from StarSender means only that StarSender accepted the request. It does not mean the message was delivered or read, and AWCMS will never show it as delivered.",
    "If a device disconnects or a send fails, AWCMS will not send through another device, number or provider on your behalf.",
    "You confirm that you are authorised to take this decision for this organisation and that you accept these risks."
  ].join("\n"),
  id: [
    "StarSender adalah gateway WhatsApp TIDAK RESMI. Ia bukan antarmuka yang diizinkan atau didukung oleh WhatsApp maupun Meta.",
    "Penggunaannya dapat melanggar ketentuan layanan WhatsApp. Nomor WhatsApp Anda dapat dibatasi atau diblokir, dan AWCMS tidak dapat mencegah ataupun memulihkannya.",
    "Respons 'success' dari StarSender hanya berarti StarSender menerima permintaan. Itu tidak berarti pesan terkirim atau terbaca, dan AWCMS tidak akan pernah menampilkannya sebagai terkirim.",
    "Bila sebuah perangkat terputus atau pengiriman gagal, AWCMS tidak akan mengirim lewat perangkat, nomor, atau penyedia lain atas nama Anda.",
    "Anda menyatakan berwenang mengambil keputusan ini untuk organisasi ini dan menerima risiko tersebut."
  ].join("\n")
};

const DEFAULT_CATALOGUE: Readonly<
  Record<RiskAcknowledgementProvider, RiskAcknowledgementEntry>
> = {
  starsender: {
    provider: "starsender",
    textVersion: STARSENDER_RISK_TEXT_VERSION,
    text: STARSENDER_RISK_TEXT,
    // HUMAN STEP (ADR-0148 condition 4): the business owner approves the text.
    approval: null
  }
};

let catalogue: Readonly<
  Record<RiskAcknowledgementProvider, RiskAcknowledgementEntry>
> = DEFAULT_CATALOGUE;

/**
 * Test seam: a test that exercises the approved path substitutes a catalogue. The
 * production catalogue is the constant above and changes only through review.
 */
export function overrideRiskAcknowledgementCatalogueForTests(
  next: Readonly<
    Record<RiskAcknowledgementProvider, RiskAcknowledgementEntry>
  > | null
): void {
  catalogue = next ?? DEFAULT_CATALOGUE;
}

/** SHA-256 over both texts, so a record proves WHICH words were shown, not just a version label. */
export function hashRiskText(entry: RiskAcknowledgementEntry): string {
  return createHash("sha256")
    .update(
      `${entry.provider}\n${entry.textVersion}\nen\n${entry.text.en}\nid\n${entry.text.id}`
    )
    .digest("hex");
}

export type ResolvedRiskAcknowledgement =
  | { approved: true; entry: RiskAcknowledgementEntry; textHash: string }
  | { approved: false; entry: RiskAcknowledgementEntry };

/** The current text of `provider`, and whether a human has approved it. Fail closed: no `approval`, no use. */
export function resolveRiskAcknowledgement(
  provider: RiskAcknowledgementProvider
): ResolvedRiskAcknowledgement {
  const entry = catalogue[provider];

  return entry.approval
    ? { approved: true, entry, textHash: hashRiskText(entry) }
    : { approved: false, entry };
}

/** What the acknowledgement endpoints return for a text. The approval is public metadata; no secret is involved. */
export function describeRiskAcknowledgement(
  provider: RiskAcknowledgementProvider
): {
  provider: RiskAcknowledgementProvider;
  textVersion: string;
  text: { en: string; id: string };
  approved: boolean;
  approval: RiskTextApproval | null;
} {
  const resolved = resolveRiskAcknowledgement(provider);

  return {
    provider,
    textVersion: resolved.entry.textVersion,
    text: resolved.entry.text,
    approved: resolved.approved,
    approval: resolved.entry.approval
  };
}
