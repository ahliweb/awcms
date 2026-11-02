/**
 * The few sentences the PUBLIC intake answers with, in the two shipped
 * locales (en, id). Kept here, not in the admin gettext catalogues, because a
 * public API answer is selected by the SUBMITTED `locale` of an anonymous
 * request rather than by an admin's session locale.
 *
 * Every refusal before the source is proven uses ONE sentence
 * (`submissionRefused`): which of token, origin, source status, module switch
 * or challenge failed is never said.
 */
export type PublicMessageKey =
  "received" | "submissionRefused" | "rateLimited" | "unavailable";

const MESSAGES: Record<"en" | "id", Record<PublicMessageKey, string>> = {
  en: {
    received: "Thank you. Your message has been received.",
    submissionRefused:
      "This submission could not be accepted. Reload the page and try again.",
    rateLimited: "Too many submissions. Please try again later.",
    unavailable: "This form is temporarily unavailable."
  },
  id: {
    received: "Terima kasih. Pesan Anda telah kami terima.",
    submissionRefused:
      "Kiriman ini tidak dapat diterima. Muat ulang halaman lalu coba lagi.",
    rateLimited: "Terlalu banyak kiriman. Silakan coba lagi nanti.",
    unavailable: "Formulir ini sedang tidak tersedia."
  }
};

/** `id` and `id-ID` select Indonesian; anything else, including no locale, is English. */
export function publicMessage(
  key: PublicMessageKey,
  locale: string | null | undefined
): string {
  const language = (locale ?? "").slice(0, 2).toLowerCase();

  return MESSAGES[language === "id" ? "id" : "en"][key];
}
