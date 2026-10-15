/**
 * The wire vocabulary of the ADR-0141 enrolment refusal, in a LEAF file.
 *
 * Kept apart from `mfa-required-permissions.ts` because that file imports the
 * module registry, and the callers that only need to RECOGNISE the refusal
 * (`defineTenantRoute`'s any-of rule, `loadAdminScreen`'s entry rule) live in
 * layers the registry import must not be pulled into at load time.
 */

/**
 * The `matchedPolicy` sentinel written to `awcms_abac_decision_logs` when this
 * gate refuses. Part of the decision-log vocabulary consumers grep for, so it is
 * a constant and not a literal at the call site.
 */
export const MFA_ENROLMENT_REQUIRED_POLICY = "mfa_enrolment_required";

/** The HTTP error code of the refusal (403). */
export const MFA_ENROLMENT_REQUIRED_CODE = "MFA_ENROLMENT_REQUIRED";

/**
 * Where a person enrols. Named in the refusal so the error is a way forward and
 * not a dead end; the page is `src/pages/admin/account.astro`, which needs a
 * session and no permission.
 */
export const MFA_ENROLMENT_PATH = "/admin/account";
