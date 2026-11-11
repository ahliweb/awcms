/**
 * Pure rules of the stage catalog (Issue #1166, ADR-0153 section 3): the
 * canonical definition hash and the guard evaluation. No database, no I/O, so a
 * guard can be simulated and audited exactly as it is enforced (L3).
 */
import { createHash } from "node:crypto";

import type { TransitionGuard } from "./crm-leads-constants";
import type { PipelineDefinition } from "./crm-leads-validation";

/**
 * SHA-256 hex of the canonical definition: stages in order (key, name,
 * category), edges sorted, guards sorted. Two revisions with the same hash
 * define the same catalog.
 */
export function definitionHash(definition: PipelineDefinition): string {
  const canonical = {
    initialStageKey: definition.initialStageKey,
    stages: definition.stages.map((stage, index) => [
      index + 1,
      stage.key,
      stage.name,
      stage.category
    ]),
    transitions: definition.transitions
      .map((edge) => [edge.from, edge.to, [...edge.guards].sort()])
      .sort((left, right) =>
        `${left[0]}>${left[1]}`.localeCompare(`${right[0]}>${right[1]}`)
      )
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export type GuardFacts = {
  ownerAssigned: boolean;
  liveContactPoints: number;
  reasonGiven: boolean;
};

/** The guards an edge carries that the facts do NOT satisfy. Empty means the move may proceed. */
export function unmetGuards(
  guards: readonly TransitionGuard[],
  facts: GuardFacts
): TransitionGuard[] {
  return guards.filter((guard) => {
    switch (guard) {
      case "owner_assigned":
        return !facts.ownerAssigned;
      case "contact_point_present":
        return facts.liveContactPoints === 0;
      case "reason_required":
        return !facts.reasonGiven;
    }
  });
}
