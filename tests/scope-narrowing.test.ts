/**
 * Scope qualification (ADR-0080, Gelombang 3 PR 3.4 of #423) — the domain half.
 *
 * `evaluateAccess`'s coverage predicate gained one clause: a fact that knows
 * which permission keys it covers may not cover any other one. The claim that
 * makes this safe to ship is narrow and absolute — **the clause can only turn a
 * `true` into a `false`** — so it is asserted as a property over a corpus rather
 * than demonstrated on one example, and asserted in BOTH states of the
 * build-time switch so that the disabled state is a tested state and not a hope.
 *
 * The existing `business-scope-access-control.test.ts` continues to pass with no
 * edits, which is the other half of the claim: every fact the repo produces
 * today carries `permissionKeys: undefined`.
 *
 * Pure: no database.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateAccess,
  scopeFactQualifies,
  type AccessRequest,
  type BusinessScopeFact,
  type TenantContext
} from "../src/modules/identity-access/domain/access-control";
import { SCOPE_NARROWING_ENABLED } from "../src/modules/identity-access/domain/scope-narrowing";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const OFFICE = "33333333-3333-4333-8333-333333333333";

const context: TenantContext = {
  tenantId: TENANT,
  tenantUserId: SUBJECT,
  identityId: SUBJECT,
  roles: ["editor"]
};

const READ_KEY = "blog_content.posts.read";
const UPDATE_KEY = "blog_content.posts.update";

function request(action: "read" | "update"): AccessRequest {
  return {
    moduleKey: "blog_content",
    activityCode: "posts",
    action,
    resourceAttributes: {
      requiredScopeType: "office",
      requiredScopeId: OFFICE
    }
  };
}

function fact(overrides: Partial<BusinessScopeFact> = {}): BusinessScopeFact {
  return {
    scopeType: "office",
    scopeId: OFFICE,
    resolved: true,
    ancestorScopes: [],
    descendantScopes: [],
    tenantWide: false,
    ...overrides
  };
}

/** Every shape a fact can take, so the property below is not asserted on one. */
const FACT_CORPUS: BusinessScopeFact[] = [
  fact(),
  fact({ resolved: false }),
  fact({ scopeId: "44444444-4444-4444-8444-444444444444" }),
  fact({ tenantWide: true, scopeType: "tenant", scopeId: TENANT }),
  fact({
    scopeType: "region",
    scopeId: "55555555-5555-4555-8555-555555555555",
    descendantScopes: [{ scopeType: "office", scopeId: OFFICE }]
  }),
  fact({
    scopeType: "desk",
    scopeId: "66666666-6666-4666-8666-666666666666",
    ancestorScopes: [{ scopeType: "office", scopeId: OFFICE }]
  })
];

const RELATION_CORPUS = [
  undefined,
  ["exact"],
  ["descendant"],
  ["ancestor"],
  ["exact", "descendant", "ancestor"]
];

function decide(
  facts: readonly BusinessScopeFact[],
  action: "read" | "update",
  relations: unknown
): boolean {
  const base = request(action);

  return evaluateAccess(
    context,
    {
      ...base,
      resourceAttributes: {
        ...base.resourceAttributes,
        ...(relations === undefined
          ? {}
          : { requiredScopeRelations: relations })
      }
    },
    new Set([READ_KEY, UPDATE_KEY]),
    facts
  ).allowed;
}

describe("the qualification clause can only narrow", () => {
  test("adding permissionKeys never turns a deny into an allow", () => {
    // The property, over every (fact shape x relation set x action) the corpus
    // can produce. A qualified fact is compared against the SAME fact without
    // the field: the qualified answer must never be `true` where the unqualified
    // one was `false`.
    for (const base of FACT_CORPUS) {
      for (const relations of RELATION_CORPUS) {
        for (const action of ["read", "update"] as const) {
          for (const keys of [
            new Set<string>(),
            new Set([READ_KEY]),
            new Set([UPDATE_KEY]),
            new Set([READ_KEY, UPDATE_KEY])
          ]) {
            const without = decide([base], action, relations);
            const withKeys = decide(
              [{ ...base, permissionKeys: keys }],
              action,
              relations
            );

            if (withKeys) {
              expect(without).toBe(true);
            }
          }
        }
      }
    }
  });

  test("and it really does narrow — the corpus is not vacuous", () => {
    // Without this, a clause that did nothing at all would satisfy the property
    // above perfectly.
    const narrowed = FACT_CORPUS.some((base) =>
      RELATION_CORPUS.some(
        (relations) =>
          decide([base], "update", relations) &&
          !decide(
            [{ ...base, permissionKeys: new Set([READ_KEY]) }],
            "update",
            relations
          )
      )
    );

    expect(narrowed).toBe(true);
  });
});

describe("scopeFactQualifies", () => {
  test("a fact with no permissionKeys qualifies for everything", () => {
    expect(scopeFactQualifies(fact(), READ_KEY, true)).toBe(true);
    expect(scopeFactQualifies(fact(), "anything.at.all", true)).toBe(true);
  });

  test("a qualified fact covers its own keys and refuses the rest", () => {
    const qualified = fact({ permissionKeys: new Set([READ_KEY]) });

    expect(scopeFactQualifies(qualified, READ_KEY, true)).toBe(true);
    expect(scopeFactQualifies(qualified, UPDATE_KEY, true)).toBe(false);
  });

  test("a TENANT-WIDE fact is qualified too, when it carries keys", () => {
    // The clause runs BEFORE the `tenantWide` short-circuit on purpose: a
    // tenant-wide grant that knows its keys must not cover a permission it does
    // not confer just because it covers every scope. Ordering, not filtering, is
    // what makes that true — so it is asserted rather than left to the reader.
    const wide = fact({
      tenantWide: true,
      scopeType: "tenant",
      scopeId: TENANT,
      permissionKeys: new Set([READ_KEY])
    });

    expect(decide([wide], "read", undefined)).toBe(true);
    expect(decide([wide], "update", undefined)).toBe(false);
  });

  test("the switch OFF restores the pre-ADR-0080 answer exactly", () => {
    // The rollback, tested rather than claimed. `enabled: false` must ignore the
    // field entirely — including for a fact whose key set is EMPTY, the shape
    // that narrows hardest.
    const empty = fact({ permissionKeys: new Set<string>() });

    expect(scopeFactQualifies(empty, READ_KEY, false)).toBe(true);
    expect(scopeFactQualifies(empty, READ_KEY, true)).toBe(false);
  });

  test("the shipped default is ON", () => {
    // If this is ever flipped deliberately, this assertion is the one that must
    // change with it — so the flip cannot be a silent one-character diff.
    expect(SCOPE_NARROWING_ENABLED).toBe(true);
    expect(
      scopeFactQualifies(fact({ permissionKeys: new Set() }), READ_KEY)
    ).toBe(false);
  });
});
