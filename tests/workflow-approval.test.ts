import { describe, expect, test } from "bun:test";

import { validateWorkflowDecisionRequestBody } from "../src/modules/workflow-approval/domain/workflow-transition";
import { validateWorkflowGraph } from "../src/modules/workflow-approval/domain/workflow-graph";
import {
  evaluateCondition,
  validateFactsAgainstSchema
} from "../src/modules/workflow-approval/domain/workflow-condition";
import { evaluateQuorumOutcome } from "../src/modules/workflow-approval/domain/workflow-quorum";
import {
  resolveEffectiveDeciderIds,
  validateCreateDelegationRequestBody,
  type WorkflowDelegationRow
} from "../src/modules/workflow-approval/domain/workflow-delegation";
import {
  canEditInPlace,
  canPublish,
  canRetire,
  canSoftDelete
} from "../src/modules/workflow-approval/domain/workflow-definition-lifecycle";
import { computeRequestHash } from "../src/modules/_shared/idempotency";

const SEQUENTIAL_GRAPH = {
  startNodeId: "manager",
  nodes: [
    {
      id: "manager",
      type: "approval",
      name: "Manager approval",
      assigneeTenantUserIds: ["11111111-1111-1111-1111-111111111111"],
      quorumRule: "all",
      onApprove: "end_approved",
      onReject: "end_rejected"
    },
    { id: "end_approved", type: "end", outcome: "approved" },
    { id: "end_rejected", type: "end", outcome: "rejected" }
  ]
};

describe("validateWorkflowGraph", () => {
  test("accepts a minimal valid sequential graph", () => {
    const result = validateWorkflowGraph(SEQUENTIAL_GRAPH, []);
    expect(result.valid).toBe(true);
  });

  test("rejects a graph missing an end node", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "manager",
        nodes: [
          {
            id: "manager",
            type: "approval",
            name: "Manager approval",
            assigneeTenantUserIds: ["11111111-1111-1111-1111-111111111111"],
            quorumRule: "all",
            onApprove: "manager",
            onReject: "manager"
          }
        ]
      },
      []
    );

    expect(result.valid).toBe(false);
  });

  test("rejects a graph with a reference to an unknown node id", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "manager",
        nodes: [
          {
            id: "manager",
            type: "approval",
            name: "Manager approval",
            assigneeTenantUserIds: ["11111111-1111-1111-1111-111111111111"],
            quorumRule: "all",
            onApprove: "does_not_exist",
            onReject: "end_rejected"
          },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      },
      []
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.message.includes("unknown node id"))
      ).toBe(true);
    }
  });

  test("rejects a cyclic graph", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "a",
        nodes: [
          {
            id: "a",
            type: "condition",
            factKey: "amount",
            operator: "gt",
            value: 0,
            onTrue: "b",
            onFalse: "b"
          },
          {
            id: "b",
            type: "condition",
            factKey: "amount",
            operator: "gt",
            value: 0,
            onTrue: "a",
            onFalse: "a"
          },
          { id: "end_approved", type: "end", outcome: "approved" }
        ]
      },
      [{ key: "amount", type: "number" }]
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.message.includes("Cycle detected"))
      ).toBe(true);
    }
  });

  test("rejects a quorum threshold above the assignee count", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "manager",
        nodes: [
          {
            id: "manager",
            type: "approval",
            name: "Manager approval",
            assigneeTenantUserIds: ["11111111-1111-1111-1111-111111111111"],
            quorumRule: "quorum",
            quorumThreshold: 5,
            onApprove: "end_approved",
            onReject: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      },
      []
    );

    expect(result.valid).toBe(false);
  });

  test("rejects a condition node referencing an undeclared fact", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "a",
        nodes: [
          {
            id: "a",
            type: "condition",
            factKey: "not_declared",
            operator: "eq",
            value: "x",
            onTrue: "end_approved",
            onFalse: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      },
      []
    );

    expect(result.valid).toBe(false);
  });

  test("rejects a condition node with an unregistered resolverName", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "a",
        nodes: [
          {
            id: "a",
            type: "condition",
            resolverName: "unknown.resolver",
            onTrue: "end_approved",
            onFalse: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      },
      [],
      ["known.resolver"]
    );

    expect(result.valid).toBe(false);
  });

  test("accepts a condition node with a registered resolverName", () => {
    const result = validateWorkflowGraph(
      {
        startNodeId: "a",
        nodes: [
          {
            id: "a",
            type: "condition",
            resolverName: "known.resolver",
            onTrue: "end_approved",
            onFalse: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      },
      [],
      ["known.resolver"]
    );

    expect(result.valid).toBe(true);
  });

  test("validates parallel/join branch-set matching", () => {
    const validParallel = validateWorkflowGraph(
      {
        startNodeId: "fanout",
        nodes: [
          {
            id: "fanout",
            type: "parallel",
            branchNodeIds: ["a", "b"],
            joinNodeId: "joiner"
          },
          { id: "a", type: "end", outcome: "approved" },
          { id: "b", type: "end", outcome: "approved" },
          { id: "joiner", type: "join", awaitNodeIds: ["a", "b"], next: "a" }
        ]
      },
      []
    );

    // Note: a/b are already `end` nodes here purely to keep this fixture
    // small — joiner.awaitNodeIds matching fanout.branchNodeIds is the
    // thing under test, not a realistic executable graph.
    expect(validParallel.valid).toBe(true);

    const mismatched = validateWorkflowGraph(
      {
        startNodeId: "fanout",
        nodes: [
          {
            id: "fanout",
            type: "parallel",
            branchNodeIds: ["a", "b"],
            joinNodeId: "joiner"
          },
          { id: "a", type: "end", outcome: "approved" },
          { id: "b", type: "end", outcome: "approved" },
          { id: "joiner", type: "join", awaitNodeIds: ["a", "c"], next: "a" }
        ]
      },
      []
    );

    expect(mismatched.valid).toBe(false);
  });
});

describe("validateFactsAgainstSchema", () => {
  const schema = [
    { key: "amount", type: "number" as const },
    { key: "region", type: "string" as const }
  ];

  test("accepts a facts object matching the schema", () => {
    const result = validateFactsAgainstSchema(
      { amount: 100, region: "id" },
      schema
    );
    expect(result.valid).toBe(true);
  });

  test("rejects an undeclared fact key (closed schema)", () => {
    const result = validateFactsAgainstSchema(
      { amount: 100, extra: "nope" },
      schema
    );
    expect(result.valid).toBe(false);
  });

  test("rejects a wrong-typed fact value", () => {
    const result = validateFactsAgainstSchema(
      { amount: "not-a-number" },
      schema
    );
    expect(result.valid).toBe(false);
  });
});

describe("evaluateCondition", () => {
  test("eq/gt/in operators evaluate correctly", () => {
    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          factKey: "region",
          operator: "eq",
          value: "id",
          onTrue: "t",
          onFalse: "f"
        },
        { region: "id" },
        "tenant-1"
      )
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          factKey: "amount",
          operator: "gt",
          value: 100,
          onTrue: "t",
          onFalse: "f"
        },
        { amount: 50 },
        "tenant-1"
      )
    ).toBe(false);

    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          factKey: "region",
          operator: "in",
          value: ["id", "sg"],
          onTrue: "t",
          onFalse: "f"
        },
        { region: "sg" },
        "tenant-1"
      )
    ).toBe(true);
  });

  test("a missing fact evaluates false (safe default-deny/pause)", () => {
    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          factKey: "amount",
          operator: "gt",
          value: 0,
          onTrue: "t",
          onFalse: "f"
        },
        {},
        "tenant-1"
      )
    ).toBe(false);
  });

  test("resolverName variant invokes the matching registered resolver", () => {
    const resolvers = [
      { name: "always_true", description: "test", evaluate: () => true }
    ];

    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          resolverName: "always_true",
          onTrue: "t",
          onFalse: "f"
        },
        {},
        "tenant-1",
        resolvers
      )
    ).toBe(true);
  });

  test("an unregistered resolverName evaluates false, not throw", () => {
    expect(
      evaluateCondition(
        {
          id: "a",
          type: "condition",
          resolverName: "missing",
          onTrue: "t",
          onFalse: "f"
        },
        {},
        "tenant-1",
        []
      )
    ).toBe(false);
  });
});

describe("evaluateQuorumOutcome", () => {
  test("a single reject completes the task as rejected regardless of rule", () => {
    expect(
      evaluateQuorumOutcome({
        quorumRule: "all",
        eligibleAssigneeCount: 3,
        decisions: ["approve", "reject"]
      })
    ).toEqual({ complete: true, outcome: "rejected" });
  });

  test("'any' completes as approved on the first approve", () => {
    expect(
      evaluateQuorumOutcome({
        quorumRule: "any",
        eligibleAssigneeCount: 3,
        decisions: ["approve"]
      })
    ).toEqual({ complete: true, outcome: "approved" });
  });

  test("'all' stays incomplete until every eligible assignee has approved", () => {
    expect(
      evaluateQuorumOutcome({
        quorumRule: "all",
        eligibleAssigneeCount: 3,
        decisions: ["approve"]
      })
    ).toEqual({ complete: false });

    expect(
      evaluateQuorumOutcome({
        quorumRule: "all",
        eligibleAssigneeCount: 3,
        decisions: ["approve", "approve", "approve"]
      })
    ).toEqual({ complete: true, outcome: "approved" });
  });

  test("'quorum' completes once the threshold is met", () => {
    expect(
      evaluateQuorumOutcome({
        quorumRule: "quorum",
        quorumThreshold: 2,
        eligibleAssigneeCount: 3,
        decisions: ["approve"]
      })
    ).toEqual({ complete: false });

    expect(
      evaluateQuorumOutcome({
        quorumRule: "quorum",
        quorumThreshold: 2,
        eligibleAssigneeCount: 3,
        decisions: ["approve", "approve"]
      })
    ).toEqual({ complete: true, outcome: "approved" });
  });

  test("a force_approve/force_reject decision always completes immediately", () => {
    expect(
      evaluateQuorumOutcome({
        quorumRule: "all",
        eligibleAssigneeCount: 5,
        decisions: ["force_approve"]
      })
    ).toEqual({ complete: true, outcome: "approved" });

    expect(
      evaluateQuorumOutcome({
        quorumRule: "all",
        eligibleAssigneeCount: 5,
        decisions: ["force_reject"]
      })
    ).toEqual({ complete: true, outcome: "rejected" });
  });
});

describe("resolveEffectiveDeciderIds (delegation effective-dating)", () => {
  const ASSIGNEE = "11111111-1111-1111-1111-111111111111";
  const DELEGATE = "22222222-2222-2222-2222-222222222222";
  const now = new Date("2026-07-13T12:00:00.000Z");

  function delegation(
    overrides: Partial<WorkflowDelegationRow>
  ): WorkflowDelegationRow {
    return {
      id: "d1",
      delegatorTenantUserId: ASSIGNEE,
      delegateTenantUserId: DELEGATE,
      workflowKey: null,
      resourceType: null,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "active",
      ...overrides
    };
  }

  test("always includes the original assignee", () => {
    const result = resolveEffectiveDeciderIds(ASSIGNEE, [], now, {
      workflowKey: "expense",
      resourceType: "invoice"
    });
    expect(result).toEqual([ASSIGNEE]);
  });

  test("includes an active, in-window, in-scope delegate", () => {
    const result = resolveEffectiveDeciderIds(ASSIGNEE, [delegation({})], now, {
      workflowKey: "expense",
      resourceType: "invoice"
    });
    expect(result).toContain(DELEGATE);
  });

  test("excludes a delegation before its effectiveFrom", () => {
    const result = resolveEffectiveDeciderIds(
      ASSIGNEE,
      [delegation({ effectiveFrom: new Date("2026-08-01T00:00:00.000Z") })],
      now,
      { workflowKey: "expense", resourceType: "invoice" }
    );
    expect(result).not.toContain(DELEGATE);
  });

  test("excludes a delegation after its effectiveTo (expired)", () => {
    const result = resolveEffectiveDeciderIds(
      ASSIGNEE,
      [delegation({ effectiveTo: new Date("2026-07-05T00:00:00.000Z") })],
      now,
      { workflowKey: "expense", resourceType: "invoice" }
    );
    expect(result).not.toContain(DELEGATE);
  });

  test("excludes a revoked delegation", () => {
    const result = resolveEffectiveDeciderIds(
      ASSIGNEE,
      [delegation({ status: "revoked" })],
      now,
      { workflowKey: "expense", resourceType: "invoice" }
    );
    expect(result).not.toContain(DELEGATE);
  });

  test("excludes a delegation scoped to a different workflowKey", () => {
    const result = resolveEffectiveDeciderIds(
      ASSIGNEE,
      [delegation({ workflowKey: "other_workflow" })],
      now,
      { workflowKey: "expense", resourceType: "invoice" }
    );
    expect(result).not.toContain(DELEGATE);
  });

  test("a delegation never widens beyond its own declared scope even with a matching resourceType-only entry", () => {
    const result = resolveEffectiveDeciderIds(
      ASSIGNEE,
      [delegation({ workflowKey: "expense", resourceType: "other_resource" })],
      now,
      { workflowKey: "expense", resourceType: "invoice" }
    );
    expect(result).not.toContain(DELEGATE);
  });
});

describe("validateCreateDelegationRequestBody", () => {
  test("rejects self-delegation", () => {
    const selfId = "11111111-1111-1111-1111-111111111111";
    const result = validateCreateDelegationRequestBody(
      { delegateTenantUserId: selfId, reason: "test" },
      selfId
    );
    expect(result.valid).toBe(false);
  });

  test("rejects effectiveTo before effectiveFrom", () => {
    const result = validateCreateDelegationRequestBody(
      {
        delegateTenantUserId: "22222222-2222-2222-2222-222222222222",
        reason: "test",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: "2026-07-01T00:00:00.000Z"
      },
      "11111111-1111-1111-1111-111111111111"
    );
    expect(result.valid).toBe(false);
  });

  test("accepts a well-formed delegation request", () => {
    const result = validateCreateDelegationRequestBody(
      {
        delegateTenantUserId: "22222222-2222-2222-2222-222222222222",
        reason: "Annual leave"
      },
      "11111111-1111-1111-1111-111111111111"
    );
    expect(result.valid).toBe(true);
  });
});

describe("workflow-definition-lifecycle transition rules", () => {
  test("only draft can be edited in place, published, or soft-deleted", () => {
    expect(canEditInPlace("draft")).toBe(true);
    expect(canEditInPlace("active")).toBe(false);
    expect(canPublish("draft")).toBe(true);
    expect(canPublish("active")).toBe(false);
    expect(canSoftDelete("draft")).toBe(true);
    expect(canSoftDelete("retired")).toBe(false);
  });

  test("only active can be retired", () => {
    expect(canRetire("active")).toBe(true);
    expect(canRetire("draft")).toBe(false);
    expect(canRetire("retired")).toBe(false);
  });
});

describe("validateWorkflowDecisionRequestBody", () => {
  test("accepts a valid approve decision", () => {
    const result = validateWorkflowDecisionRequestBody({ decision: "approve" });
    expect(result.valid).toBe(true);
  });

  test("accepts a valid reject decision with a reason", () => {
    const result = validateWorkflowDecisionRequestBody({
      decision: "reject",
      reason: "Budget exceeded"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.reason).toBe("Budget exceeded");
    }
  });

  test("rejects an invalid decision value", () => {
    const result = validateWorkflowDecisionRequestBody({ decision: "maybe" });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-string reason", () => {
    const result = validateWorkflowDecisionRequestBody({
      decision: "approve",
      reason: 123
    });
    expect(result.valid).toBe(false);
  });
});

describe("computeRequestHash", () => {
  test("is stable regardless of key order", () => {
    const a = computeRequestHash({ decision: "approve", taskId: "t1" });
    const b = computeRequestHash({ taskId: "t1", decision: "approve" });
    expect(a).toBe(b);
  });

  test("differs when the payload differs", () => {
    const a = computeRequestHash({ decision: "approve", taskId: "t1" });
    const b = computeRequestHash({ decision: "reject", taskId: "t1" });
    expect(a).not.toBe(b);
  });
});
