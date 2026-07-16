/**
 * Definition lifecycle rules (Issue #747): draft -> active -> retired,
 * version history, immutability of published/retired versions. Pure
 * functions only — `application/workflow-definition-directory.ts` owns
 * all I/O (including the transactional "retire the previous active
 * version" step that accompanies `publish`).
 */

export type DefinitionLifecycleStatus = "draft" | "active" | "retired";

export type CreateWorkflowDefinitionInput = {
  workflowKey: string;
  name: string;
  description?: string;
  graph: unknown;
  factsSchema?: unknown;
};

export type ValidationError = { field: string; message: string };
export type CreateDefinitionValidationResult =
  | { valid: true; value: CreateWorkflowDefinitionInput }
  | { valid: false; errors: ValidationError[] };

const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

export function validateCreateWorkflowDefinitionRequestBody(
  body: unknown
): CreateDefinitionValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const workflowKey = record.workflowKey;
  const name = record.name;

  if (
    typeof workflowKey !== "string" ||
    !WORKFLOW_KEY_PATTERN.test(workflowKey)
  ) {
    errors.push({
      field: "workflowKey",
      message: "workflowKey must match /^[a-z][a-z0-9_]{0,63}$/."
    });
  }

  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_NAME_LENGTH
  ) {
    errors.push({
      field: "name",
      message: `name is required (1-${MAX_NAME_LENGTH} characters).`
    });
  }

  if (
    record.description !== undefined &&
    (typeof record.description !== "string" ||
      record.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    errors.push({
      field: "description",
      message: `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters.`
    });
  }

  if (record.graph === undefined) {
    errors.push({ field: "graph", message: "graph is required." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      workflowKey: workflowKey as string,
      name: name as string,
      description:
        typeof record.description === "string" ? record.description : undefined,
      graph: record.graph,
      factsSchema: record.factsSchema ?? []
    }
  };
}

export type UpdateWorkflowDefinitionInput = {
  name?: string;
  description?: string;
  graph?: unknown;
  factsSchema?: unknown;
};

export type UpdateDefinitionValidationResult =
  | { valid: true; value: UpdateWorkflowDefinitionInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateWorkflowDefinitionRequestBody(
  body: unknown
): UpdateDefinitionValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (
    record.name !== undefined &&
    (typeof record.name !== "string" ||
      record.name.trim().length === 0 ||
      record.name.length > MAX_NAME_LENGTH)
  ) {
    errors.push({
      field: "name",
      message: `name must be 1-${MAX_NAME_LENGTH} characters when present.`
    });
  }

  if (
    record.description !== undefined &&
    (typeof record.description !== "string" ||
      record.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    errors.push({
      field: "description",
      message: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      name: record.name as string | undefined,
      description: record.description as string | undefined,
      graph: record.graph,
      factsSchema: record.factsSchema
    }
  };
}

/** Only a `draft` definition may be edited in place — publishing/retiring freeze the row (Issue #747 acceptance criterion: "active versions cannot be edited in place"). */
export function canEditInPlace(status: DefinitionLifecycleStatus): boolean {
  return status === "draft";
}

/** Only a `draft` may transition to `active`. */
export function canPublish(status: DefinitionLifecycleStatus): boolean {
  return status === "draft";
}

/** Only an `active` version may be voluntarily retired (a `draft` is instead soft-deleted; a `retired` version is already terminal). */
export function canRetire(status: DefinitionLifecycleStatus): boolean {
  return status === "active";
}

/** Only a `draft` may be soft-deleted — `active`/`retired` rows are permanent version history (never deleted, matching AGENTS.md rule #12/#13's append-only-history spirit for anything with recorded decisions against it). */
export function canSoftDelete(status: DefinitionLifecycleStatus): boolean {
  return status === "draft";
}
