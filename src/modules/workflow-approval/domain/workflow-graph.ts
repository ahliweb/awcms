/**
 * Generic workflow node/transition graph (Issue #747, epic
 * `platform-evolution` #738, Wave 2). Replaces the Issue 11.1 linear
 * `steps` list with a small, closed set of node types — no scripting/eval
 * engine (doc 21 §3 decision tree, node Q5): every node type is a fixed,
 * reviewed-source-code shape, and `condition` nodes only ever compare a
 * declared fact against a literal using a bounded operator set, never an
 * arbitrary expression.
 *
 * Node types:
 * - `approval` — one or more assignees decide; `quorumRule` governs how
 *   many approvals complete the node (`all`, `any`, or `quorum` with an
 *   explicit `quorumThreshold`). Any single `reject` decision completes
 *   the node as rejected regardless of `quorumRule` (a conservative,
 *   documented default — one stakeholder's reject is a hard stop, not a
 *   vote to be outvoted).
 * - `condition` — evaluates one bounded comparison
 *   (`domain/workflow-condition.ts`) over a fact declared in the
 *   definition's `factsSchema` and routes to `onTrue`/`onFalse`.
 * - `parallel` — fans out into 2+ concurrent branch nodes, all funnelling
 *   into one `join` node.
 * - `join` — proceeds to `next` once every one of `awaitNodeIds` has
 *   completed for the same instance (`all`-join only in this issue —
 *   `any`-join is deferred, see module README §Deferred).
 * - `notify` — fires a notification through the
 *   `WorkflowNotificationPort` (capability port, ADR-0011) and advances
 *   to `next` immediately; never blocks instance progress.
 * - `end` — terminal; sets the instance outcome.
 */

export type ConditionOperator =
  "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

export type FactType = "string" | "number" | "boolean";

export type FactDeclaration = {
  key: string;
  type: FactType;
  description?: string;
};

export type QuorumRule = "all" | "any" | "quorum";

export type ApprovalNode = {
  id: string;
  type: "approval";
  name: string;
  assigneeTenantUserIds: string[];
  quorumRule: QuorumRule;
  quorumThreshold?: number;
  escalation?: {
    timeoutMinutes: number;
    escalateToTenantUserId: string;
    maxEscalations: number;
  };
  onApprove: string;
  onReject: string;
};

/**
 * Two mutually-exclusive shapes: the built-in bounded comparison
 * (`factKey`/`operator`/`value`, always available), or a reference to a
 * module-contributed, statically-registered resolver
 * (`resolverName` — see `_shared/ports/workflow-condition-port.ts` and
 * `infrastructure/condition-action-registry.ts`). Exactly one of the two
 * shapes must be present — never both, never neither
 * (`validateConditionNode` enforces this).
 */
export type ConditionNode = {
  id: string;
  type: "condition";
  factKey?: string;
  operator?: ConditionOperator;
  value?: string | number | boolean | Array<string | number>;
  resolverName?: string;
  onTrue: string;
  onFalse: string;
};

export type ParallelNode = {
  id: string;
  type: "parallel";
  branchNodeIds: string[];
  joinNodeId: string;
};

export type JoinNode = {
  id: string;
  type: "join";
  awaitNodeIds: string[];
  next: string;
};

export type NotifyNode = {
  id: string;
  type: "notify";
  templateKey: string;
  recipientTenantUserIds: string[];
  next: string;
};

export type EndNode = {
  id: string;
  type: "end";
  outcome: "approved" | "rejected";
};

export type WorkflowNode =
  ApprovalNode | ConditionNode | ParallelNode | JoinNode | NotifyNode | EndNode;

export type WorkflowGraph = {
  startNodeId: string;
  nodes: WorkflowNode[];
};

export type GraphValidationError = { field: string; message: string };

export type GraphValidationResult =
  | { valid: true; value: WorkflowGraph }
  | { valid: false; errors: GraphValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_NODES = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outboundNodeIds(node: WorkflowNode): string[] {
  switch (node.type) {
    case "approval":
      return [node.onApprove, node.onReject];
    case "condition":
      return [node.onTrue, node.onFalse];
    case "parallel":
      return [...node.branchNodeIds, node.joinNodeId];
    case "join":
      return [node.next];
    case "notify":
      return [node.next];
    case "end":
      return [];
  }
}

/**
 * Validates a candidate graph's structural shape AND declared facts
 * schema together (a `condition` node's `factKey` must exist in
 * `factsSchema` with a compatible type) — called on every definition
 * write (create/update/new-version) and again, defense-in-depth, right
 * before `publish` (`application/workflow-definition-directory.ts`).
 * Never executes anything — purely structural/type checking.
 */
export function validateWorkflowGraph(
  graphInput: unknown,
  factsSchemaInput: unknown,
  knownResolverNames: readonly string[] = []
): GraphValidationResult {
  const errors: GraphValidationError[] = [];

  if (!isPlainObject(graphInput)) {
    return {
      valid: false,
      errors: [{ field: "graph", message: "graph must be an object." }]
    };
  }

  const rawNodes = graphInput.nodes;
  const startNodeId = graphInput.startNodeId;

  if (typeof startNodeId !== "string" || startNodeId.length === 0) {
    errors.push({
      field: "graph.startNodeId",
      message: "startNodeId is required."
    });
  }

  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return {
      valid: false,
      errors: [
        ...errors,
        { field: "graph.nodes", message: "nodes must be a non-empty array." }
      ]
    };
  }

  if (rawNodes.length > MAX_NODES) {
    errors.push({
      field: "graph.nodes",
      message: `nodes must not exceed ${MAX_NODES} entries.`
    });
  }

  const facts = validateFactsSchema(factsSchemaInput);

  if (!facts.valid) {
    errors.push(
      ...facts.errors.map((e) => ({ field: e.field, message: e.message }))
    );
  }

  const factsByKey = new Map<string, FactType>(
    facts.valid ? facts.value.map((f) => [f.key, f.type]) : []
  );

  const nodes: WorkflowNode[] = [];
  const seenIds = new Set<string>();

  const resolverNameSet = new Set(knownResolverNames);

  rawNodes.forEach((entry, index) => {
    const prefix = `graph.nodes[${index}]`;
    const node = validateOneNode(
      entry,
      prefix,
      factsByKey,
      resolverNameSet,
      errors
    );

    if (node) {
      if (seenIds.has(node.id)) {
        errors.push({
          field: `${prefix}.id`,
          message: `Duplicate node id "${node.id}".`
        });
      }
      seenIds.add(node.id);
      nodes.push(node);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const idSet = new Set(nodes.map((n) => n.id));

  if (typeof startNodeId === "string" && !idSet.has(startNodeId)) {
    errors.push({
      field: "graph.startNodeId",
      message: `startNodeId "${startNodeId}" does not match any node id.`
    });
  }

  for (const node of nodes) {
    for (const targetId of outboundNodeIds(node)) {
      if (!idSet.has(targetId)) {
        errors.push({
          field: `graph.nodes[${node.id}]`,
          message: `References unknown node id "${targetId}".`
        });
      }
    }

    if (node.type === "parallel") {
      const uniqueBranches = new Set(node.branchNodeIds);

      if (
        node.branchNodeIds.length < 2 ||
        uniqueBranches.size !== node.branchNodeIds.length
      ) {
        errors.push({
          field: `graph.nodes[${node.id}].branchNodeIds`,
          message: "parallel nodes require at least 2 distinct branch node ids."
        });
      }

      const joinNode = nodes.find((n) => n.id === node.joinNodeId);

      if (joinNode && joinNode.type !== "join") {
        errors.push({
          field: `graph.nodes[${node.id}].joinNodeId`,
          message: `joinNodeId "${node.joinNodeId}" must reference a "join" node.`
        });
      } else if (joinNode && joinNode.type === "join") {
        const expected = new Set(node.branchNodeIds);
        const actual = new Set(joinNode.awaitNodeIds);
        const matches =
          expected.size === actual.size &&
          [...expected].every((id) => actual.has(id));

        if (!matches) {
          errors.push({
            field: `graph.nodes[${node.id}].joinNodeId`,
            message: `join node "${joinNode.id}"'s awaitNodeIds must exactly match this parallel node's branchNodeIds.`
          });
        }
      }
    }

    if (node.type === "join" && node.awaitNodeIds.length < 2) {
      errors.push({
        field: `graph.nodes[${node.id}].awaitNodeIds`,
        message: "join nodes require at least 2 awaited node ids."
      });
    }
  }

  if (!nodes.some((n) => n.type === "end")) {
    errors.push({
      field: "graph.nodes",
      message: "graph must contain at least one end node."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const cycleError = detectCycle(nodes, startNodeId as string);

  if (cycleError) {
    return { valid: false, errors: [cycleError] };
  }

  return { valid: true, value: { startNodeId: startNodeId as string, nodes } };
}

function validateOneNode(
  entry: unknown,
  prefix: string,
  factsByKey: Map<string, FactType>,
  resolverNameSet: Set<string>,
  errors: GraphValidationError[]
): WorkflowNode | null {
  if (!isPlainObject(entry)) {
    errors.push({ field: prefix, message: "node must be an object." });
    return null;
  }

  const id = entry.id;
  const type = entry.type;

  if (typeof id !== "string" || !NODE_ID_PATTERN.test(id)) {
    errors.push({
      field: `${prefix}.id`,
      message: "id must match /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/."
    });
    return null;
  }

  if (type === "approval") {
    return validateApprovalNode(entry, prefix, id, errors);
  }
  if (type === "condition") {
    return validateConditionNode(
      entry,
      prefix,
      id,
      factsByKey,
      resolverNameSet,
      errors
    );
  }
  if (type === "parallel") {
    return validateParallelNode(entry, prefix, id, errors);
  }
  if (type === "join") {
    return validateJoinNode(entry, prefix, id, errors);
  }
  if (type === "notify") {
    return validateNotifyNode(entry, prefix, id, errors);
  }
  if (type === "end") {
    return validateEndNode(entry, prefix, id, errors);
  }

  errors.push({
    field: `${prefix}.type`,
    message:
      'type must be one of "approval", "condition", "parallel", "join", "notify", "end".'
  });
  return null;
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  errors: GraphValidationError[]
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ field, message: "must be a non-empty string." });
    return null;
  }
  return value;
}

function validateApprovalNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  errors: GraphValidationError[]
): ApprovalNode | null {
  const localErrors: GraphValidationError[] = [];
  const name = requireNonEmptyString(entry.name, `${prefix}.name`, localErrors);
  const onApprove = requireNonEmptyString(
    entry.onApprove,
    `${prefix}.onApprove`,
    localErrors
  );
  const onReject = requireNonEmptyString(
    entry.onReject,
    `${prefix}.onReject`,
    localErrors
  );
  const assigneeTenantUserIds = entry.assigneeTenantUserIds;

  if (
    !Array.isArray(assigneeTenantUserIds) ||
    assigneeTenantUserIds.length === 0 ||
    !assigneeTenantUserIds.every(
      (v) => typeof v === "string" && UUID_PATTERN.test(v)
    )
  ) {
    localErrors.push({
      field: `${prefix}.assigneeTenantUserIds`,
      message: "must be a non-empty array of UUID strings."
    });
  }

  const quorumRule = entry.quorumRule;

  if (quorumRule !== "all" && quorumRule !== "any" && quorumRule !== "quorum") {
    localErrors.push({
      field: `${prefix}.quorumRule`,
      message: 'must be "all", "any", or "quorum".'
    });
  }

  const assigneeCount = Array.isArray(assigneeTenantUserIds)
    ? assigneeTenantUserIds.length
    : 0;
  let quorumThreshold: number | undefined;

  if (quorumRule === "quorum") {
    const threshold = entry.quorumThreshold;

    if (
      typeof threshold !== "number" ||
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      (assigneeCount > 0 && threshold > assigneeCount)
    ) {
      localErrors.push({
        field: `${prefix}.quorumThreshold`,
        message:
          "required for quorumRule 'quorum': integer between 1 and assigneeTenantUserIds.length."
      });
    } else {
      quorumThreshold = threshold;
    }
  }

  let escalation: ApprovalNode["escalation"];

  if (entry.escalation !== undefined) {
    if (!isPlainObject(entry.escalation)) {
      localErrors.push({
        field: `${prefix}.escalation`,
        message: "must be an object when present."
      });
    } else {
      const timeoutMinutes = entry.escalation.timeoutMinutes;
      const escalateTo = entry.escalation.escalateToTenantUserId;
      const maxEscalations = entry.escalation.maxEscalations;

      if (
        typeof timeoutMinutes !== "number" ||
        !Number.isFinite(timeoutMinutes) ||
        timeoutMinutes <= 0
      ) {
        localErrors.push({
          field: `${prefix}.escalation.timeoutMinutes`,
          message: "must be a positive number."
        });
      }
      if (typeof escalateTo !== "string" || !UUID_PATTERN.test(escalateTo)) {
        localErrors.push({
          field: `${prefix}.escalation.escalateToTenantUserId`,
          message: "must be a UUID string."
        });
      }
      if (
        typeof maxEscalations !== "number" ||
        !Number.isInteger(maxEscalations) ||
        maxEscalations < 1 ||
        maxEscalations > 10
      ) {
        localErrors.push({
          field: `${prefix}.escalation.maxEscalations`,
          message: "must be an integer between 1 and 10."
        });
      }

      if (localErrors.length === 0) {
        escalation = {
          timeoutMinutes: timeoutMinutes as number,
          escalateToTenantUserId: escalateTo as string,
          maxEscalations: maxEscalations as number
        };
      }
    }
  }

  if (localErrors.length > 0) {
    errors.push(...localErrors);
    return null;
  }

  return {
    id,
    type: "approval",
    name: name as string,
    assigneeTenantUserIds: assigneeTenantUserIds as string[],
    quorumRule: quorumRule as QuorumRule,
    quorumThreshold,
    escalation,
    onApprove: onApprove as string,
    onReject: onReject as string
  };
}

const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in"
];

function validateConditionNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  factsByKey: Map<string, FactType>,
  resolverNameSet: Set<string>,
  errors: GraphValidationError[]
): ConditionNode | null {
  const localErrors: GraphValidationError[] = [];
  const onTrue = requireNonEmptyString(
    entry.onTrue,
    `${prefix}.onTrue`,
    localErrors
  );
  const onFalse = requireNonEmptyString(
    entry.onFalse,
    `${prefix}.onFalse`,
    localErrors
  );

  const hasResolver = entry.resolverName !== undefined;
  const hasComparison =
    entry.factKey !== undefined ||
    entry.operator !== undefined ||
    entry.value !== undefined;

  if (hasResolver && hasComparison) {
    localErrors.push({
      field: prefix,
      message:
        "a condition node must use EITHER resolverName OR factKey/operator/value, not both."
    });
  } else if (!hasResolver && !hasComparison) {
    localErrors.push({
      field: prefix,
      message:
        "a condition node must declare resolverName OR factKey/operator/value."
    });
  } else if (hasResolver) {
    const resolverName = entry.resolverName;

    if (
      typeof resolverName !== "string" ||
      !resolverNameSet.has(resolverName)
    ) {
      localErrors.push({
        field: `${prefix}.resolverName`,
        message: `resolverName "${String(resolverName)}" is not a registered WorkflowConditionResolver.`
      });
    }

    if (localErrors.length > 0) {
      errors.push(...localErrors);
      return null;
    }

    return {
      id,
      type: "condition",
      resolverName: resolverName as string,
      onTrue: onTrue as string,
      onFalse: onFalse as string
    };
  } else {
    const factKey = requireNonEmptyString(
      entry.factKey,
      `${prefix}.factKey`,
      localErrors
    );
    const operator = entry.operator;

    if (!CONDITION_OPERATORS.includes(operator as ConditionOperator)) {
      localErrors.push({
        field: `${prefix}.operator`,
        message: `operator must be one of ${CONDITION_OPERATORS.join(", ")}.`
      });
    }

    if (typeof factKey === "string" && !factsByKey.has(factKey)) {
      localErrors.push({
        field: `${prefix}.factKey`,
        message: `factKey "${factKey}" is not declared in factsSchema.`
      });
    }

    const value = entry.value;
    const valueIsValidShape =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) &&
        value.every((v) => typeof v === "string" || typeof v === "number"));

    if (!valueIsValidShape) {
      localErrors.push({
        field: `${prefix}.value`,
        message:
          "must be a string, number, boolean, or array of string/number (for 'in')."
      });
    }

    if (operator === "in" && !Array.isArray(value)) {
      localErrors.push({
        field: `${prefix}.value`,
        message: "operator 'in' requires value to be an array."
      });
    }

    if (localErrors.length > 0) {
      errors.push(...localErrors);
      return null;
    }

    return {
      id,
      type: "condition",
      factKey: factKey as string,
      operator: operator as ConditionOperator,
      value: value as ConditionNode["value"],
      onTrue: onTrue as string,
      onFalse: onFalse as string
    };
  }

  errors.push(...localErrors);
  return null;
}

function validateParallelNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  errors: GraphValidationError[]
): ParallelNode | null {
  const localErrors: GraphValidationError[] = [];
  const branchNodeIds = entry.branchNodeIds;
  const joinNodeId = requireNonEmptyString(
    entry.joinNodeId,
    `${prefix}.joinNodeId`,
    localErrors
  );

  if (
    !Array.isArray(branchNodeIds) ||
    !branchNodeIds.every((v) => typeof v === "string" && v.length > 0)
  ) {
    localErrors.push({
      field: `${prefix}.branchNodeIds`,
      message: "must be an array of non-empty strings."
    });
  }

  if (localErrors.length > 0) {
    errors.push(...localErrors);
    return null;
  }

  return {
    id,
    type: "parallel",
    branchNodeIds: branchNodeIds as string[],
    joinNodeId: joinNodeId as string
  };
}

function validateJoinNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  errors: GraphValidationError[]
): JoinNode | null {
  const localErrors: GraphValidationError[] = [];
  const awaitNodeIds = entry.awaitNodeIds;
  const next = requireNonEmptyString(entry.next, `${prefix}.next`, localErrors);

  if (
    !Array.isArray(awaitNodeIds) ||
    !awaitNodeIds.every((v) => typeof v === "string" && v.length > 0)
  ) {
    localErrors.push({
      field: `${prefix}.awaitNodeIds`,
      message: "must be an array of non-empty strings."
    });
  }

  if (localErrors.length > 0) {
    errors.push(...localErrors);
    return null;
  }

  return {
    id,
    type: "join",
    awaitNodeIds: awaitNodeIds as string[],
    next: next as string
  };
}

function validateNotifyNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  errors: GraphValidationError[]
): NotifyNode | null {
  const localErrors: GraphValidationError[] = [];
  const templateKey = requireNonEmptyString(
    entry.templateKey,
    `${prefix}.templateKey`,
    localErrors
  );
  const next = requireNonEmptyString(entry.next, `${prefix}.next`, localErrors);
  const recipientTenantUserIds = entry.recipientTenantUserIds;

  if (
    !Array.isArray(recipientTenantUserIds) ||
    recipientTenantUserIds.length === 0 ||
    !recipientTenantUserIds.every(
      (v) => typeof v === "string" && UUID_PATTERN.test(v)
    )
  ) {
    localErrors.push({
      field: `${prefix}.recipientTenantUserIds`,
      message: "must be a non-empty array of UUID strings."
    });
  }

  if (localErrors.length > 0) {
    errors.push(...localErrors);
    return null;
  }

  return {
    id,
    type: "notify",
    templateKey: templateKey as string,
    recipientTenantUserIds: recipientTenantUserIds as string[],
    next: next as string
  };
}

function validateEndNode(
  entry: Record<string, unknown>,
  prefix: string,
  id: string,
  errors: GraphValidationError[]
): EndNode | null {
  const outcome = entry.outcome;

  if (outcome !== "approved" && outcome !== "rejected") {
    errors.push({
      field: `${prefix}.outcome`,
      message: 'outcome must be "approved" or "rejected".'
    });
    return null;
  }

  return { id, type: "end", outcome };
}

/**
 * DFS cycle detection over deterministic outbound edges. `join` nodes'
 * `awaitNodeIds` are inbound (not outbound) edges, so they cannot
 * themselves introduce a cycle here — a real infinite loop can only come
 * from approval/condition/parallel/notify chaining back to an
 * already-visited node on the SAME path.
 */
function detectCycle(
  nodes: WorkflowNode[],
  startNodeId: string
): GraphValidationError | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(nodeId: string): string | null {
    if (visited.has(nodeId)) return null;
    if (visiting.has(nodeId)) return nodeId;

    visiting.add(nodeId);
    const node = byId.get(nodeId);

    if (node) {
      for (const next of outboundNodeIds(node)) {
        const cycleAt = visit(next);
        if (cycleAt) return cycleAt;
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }

  const cycleNodeId = visit(startNodeId);

  if (cycleNodeId) {
    return {
      field: "graph.nodes",
      message: `Cycle detected in graph reachable from node "${cycleNodeId}".`
    };
  }

  // Also check any node not reachable from start (e.g. an orphan branch) —
  // still validated for cycles so a definition can never hide an infinite
  // loop in a currently-unreachable subgraph that becomes reachable later
  // via `in`-place edits (defense in depth; each edit revalidates anyway).
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const cycleNodeId2 = visit(node.id);
      if (cycleNodeId2) {
        return {
          field: "graph.nodes",
          message: `Cycle detected in graph reachable from node "${cycleNodeId2}".`
        };
      }
    }
  }

  return null;
}

export type FactsSchemaValidationResult =
  | { valid: true; value: FactDeclaration[] }
  | { valid: false; errors: GraphValidationError[] };

const FACT_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_FACTS = 32;

export function validateFactsSchema(
  input: unknown
): FactsSchemaValidationResult {
  if (!Array.isArray(input)) {
    return {
      valid: false,
      errors: [
        { field: "factsSchema", message: "factsSchema must be an array." }
      ]
    };
  }

  if (input.length > MAX_FACTS) {
    return {
      valid: false,
      errors: [
        {
          field: "factsSchema",
          message: `factsSchema must not exceed ${MAX_FACTS} entries.`
        }
      ]
    };
  }

  const errors: GraphValidationError[] = [];
  const facts: FactDeclaration[] = [];
  const seen = new Set<string>();

  input.forEach((entry, index) => {
    const prefix = `factsSchema[${index}]`;

    if (!isPlainObject(entry)) {
      errors.push({ field: prefix, message: "must be an object." });
      return;
    }

    const key = entry.key;
    const type = entry.type;

    if (typeof key !== "string" || !FACT_KEY_PATTERN.test(key)) {
      errors.push({
        field: `${prefix}.key`,
        message: "must match /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/."
      });
      return;
    }

    if (type !== "string" && type !== "number" && type !== "boolean") {
      errors.push({
        field: `${prefix}.type`,
        message: 'must be "string", "number", or "boolean".'
      });
      return;
    }

    if (seen.has(key)) {
      errors.push({
        field: `${prefix}.key`,
        message: `Duplicate fact key "${key}".`
      });
      return;
    }

    seen.add(key);
    facts.push({
      key,
      type,
      description:
        typeof entry.description === "string" ? entry.description : undefined
    });
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: facts };
}

export function findNode(
  graph: WorkflowGraph,
  nodeId: string
): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}
