/**
 * Single source of truth for `form_drafts`' ABAC permissions.
 *
 * Three things must agree or the module is subtly broken: `module.ts`'s
 * `permissions` array (what the module DECLARES), `sql/063`'s catalog seed
 * (what the database KNOWS), and each route's `authorizeInTransaction` guard
 * (what is ENFORCED). Declaring them once here and importing from all three is
 * what keeps them from drifting — a guard naming an action the seed never
 * inserted denies every caller including the owner, and does so while looking
 * entirely correct in review.
 */
export type FormDraftPermission = {
  activityCode: "draft";
  action: "read" | "create" | "update" | "delete";
  description: string;
};

export const FORM_DRAFT_PERMISSIONS: readonly FormDraftPermission[] = [
  {
    activityCode: "draft",
    action: "read",
    description: "Read own tenant form drafts"
  },
  {
    activityCode: "draft",
    action: "create",
    description: "Create a form draft"
  },
  {
    activityCode: "draft",
    // Submitting is a transition on a draft you may already edit, so
    // `POST /{id}/submit` guards on this same action rather than a `submit`
    // action that would have to widen the `AccessAction` union.
    action: "update",
    description: "Update or submit a form draft"
  },
  {
    activityCode: "draft",
    action: "delete",
    description: "Delete (abandon) a form draft"
  }
] as const;

export const FORM_DRAFTS_MODULE_KEY = "form_drafts";
