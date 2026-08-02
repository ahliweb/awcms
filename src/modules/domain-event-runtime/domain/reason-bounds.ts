/**
 * The reason-text bound this module's operator actions validate against, in
 * one place.
 *
 * `const MAX_REASON_LENGTH = 500` was written out twice — once in the consumer
 * pause route, once in the delivery replay route. Two copies of a number agree
 * until one is edited, and the moment a screen renders `maxlength` from it a
 * third copy would drift into a browser accepting what the server rejects with
 * a 400 the operator cannot act on.
 *
 * Both actions are audited, so the minimum is 1: a pause recorded without a
 * reason records that a consumer stopped without recording why.
 *
 * Pure constants — no I/O, no imports.
 */
export const MIN_REASON_LENGTH = 1;
export const MAX_REASON_LENGTH = 500;
