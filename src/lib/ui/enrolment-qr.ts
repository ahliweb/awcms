/**
 * DOM side of the TOTP enrolment QR (Issue #1316), split from
 * `admin-account-client.ts` so its behaviour can be tested against a small
 * document stub instead of by matching source text.
 *
 * The otpauth URI carries the shared secret. It is passed to `encodeQr` and
 * nowhere else: never stored, logged, or written to an attribute, text node,
 * `title`, `dataset` or markup.
 */
import {
  QrCapacityError,
  encodeQr,
  qrPathData,
  qrViewBoxSize
} from "../qr/qr-code";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** True between a rendered enrolment and its completion. */
let pending = false;

/**
 * Drop the enrolment secret AND its QR from the DOM, on completion and when
 * the page is left.
 */
export function clearEnrolmentSecret(doc: Document): void {
  doc.getElementById("account-mfa-qr")?.replaceChildren();
  const secret = doc.getElementById("account-mfa-secret");
  if (secret) secret.textContent = "";
}

/** Enrolment finished: clear it and stop treating it as restorable. */
export function finishEnrolment(doc: Document): void {
  pending = false;
  clearEnrolmentSecret(doc);
}

/**
 * The page came back from the back/forward cache after `pagehide` emptied the
 * secret and QR of an enrolment that was still pending. Hide the empty
 * enrolment form and offer the start form again, so the person can begin a
 * fresh enrolment instead of staring at a blank secret.
 */
export function restoreAfterPageCache(doc: Document): void {
  if (!pending) return;
  pending = false;
  const enrolment = doc.getElementById("account-mfa-enrolment");
  if (enrolment) enrolment.hidden = true;
  const start = doc.getElementById("account-mfa-start-form");
  if (start) start.hidden = false;
}

/**
 * Render the otpauth URI as a locally encoded SVG QR code: no network, no
 * inline script or style, no markup parsing. A URI that does not fit leaves the
 * QR out and the manual-entry secret stays.
 */
export function renderEnrolmentQr(
  doc: Document,
  otpauthUri: string,
  label: string
): void {
  const host = doc.getElementById("account-mfa-qr");
  if (!host) return;

  let matrix;
  try {
    matrix = encodeQr(otpauthUri);
  } catch (error) {
    host.replaceChildren();
    if (error instanceof QrCapacityError) return;
    throw error;
  }

  pending = true;
  const size = qrViewBoxSize(matrix);
  const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");

  const title = doc.createElementNS(SVG_NAMESPACE, "title");
  title.textContent = label;
  const background = doc.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#ffffff");
  const modules = doc.createElementNS(SVG_NAMESPACE, "path");
  modules.setAttribute("d", qrPathData(matrix));
  modules.setAttribute("fill", "#000000");

  svg.append(title, background, modules);
  host.replaceChildren(svg);
}
