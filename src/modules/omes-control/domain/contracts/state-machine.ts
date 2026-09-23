/**
 * A generic, dependency-free finite-state-machine transition checker
 * (Issue ahliweb/omes#197, mirroring `lib/omes/py/jobs/states.py`, itself
 * from issue #92).
 *
 * Several Control Center records (subscription/entitlement state, invoice
 * state) have a closed set of lifecycle states and a closed set of allowed
 * transitions between them. The table lives as DATA in the pinned OMES
 * contract snapshot (`*.states.json`) rather than being duplicated as
 * hand-written TypeScript control flow — a PR that changes what transitions
 * are legal touches only the vendored JSON (via a re-sync from a newer
 * pinned OMES commit), never this checker.
 */

export type StateTable = {
  states: string[];
  initial_states?: string[];
  terminal_states?: string[];
  transitions: { from: string; to: string }[];
};

/** Raised for a malformed state table — a bug in the table itself. */
export class StateMachineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateMachineError";
  }
}

/** Raised by `assertTransition()` when a transition is not allowed. */
export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

/** A closed-world finite state machine loaded from a state table. */
export class StateMachine {
  readonly states: ReadonlySet<string>;
  readonly initialStates: ReadonlySet<string>;
  readonly terminalStates: ReadonlySet<string>;
  private readonly transitionPairs: ReadonlySet<string>;

  constructor(table: StateTable) {
    if (!Array.isArray(table?.states) || table.states.length === 0) {
      throw new StateMachineError(
        "state table must have a non-empty 'states' list"
      );
    }
    if (!Array.isArray(table?.transitions)) {
      throw new StateMachineError("state table must have a 'transitions' list");
    }

    this.states = new Set(table.states);
    this.initialStates = new Set(table.initial_states ?? []);
    this.terminalStates = new Set(table.terminal_states ?? []);

    for (const [name, group] of [
      ["initial_states", this.initialStates],
      ["terminal_states", this.terminalStates]
    ] as const) {
      const unknown = [...group].filter((s) => !this.states.has(s)).sort();
      if (unknown.length > 0) {
        throw new StateMachineError(
          `${name} references unknown state(s): [${unknown.join(", ")}]`
        );
      }
    }

    const pairs = new Set<string>();
    for (const edge of table.transitions) {
      if (
        !edge ||
        typeof edge !== "object" ||
        !("from" in edge) ||
        !("to" in edge)
      ) {
        throw new StateMachineError(
          `malformed transition entry: ${JSON.stringify(edge)}`
        );
      }
      const { from, to } = edge;
      if (!this.states.has(from)) {
        throw new StateMachineError(
          `transition references unknown 'from' state: '${from}'`
        );
      }
      if (!this.states.has(to)) {
        throw new StateMachineError(
          `transition references unknown 'to' state: '${to}'`
        );
      }
      pairs.add(`${from}\u0000${to}`);
    }
    this.transitionPairs = pairs;
  }

  isValidTransition(fromState: string, toState: string): boolean {
    if (fromState === toState) {
      // A no-op "transition" to the same state is always allowed — this is
      // what makes replaying an already-applied event idempotent-safe.
      return this.states.has(fromState);
    }
    return this.transitionPairs.has(`${fromState}\u0000${toState}`);
  }

  assertTransition(fromState: string, toState: string): void {
    if (!this.states.has(fromState)) {
      throw new TransitionError(`unknown state: '${fromState}'`);
    }
    if (!this.states.has(toState)) {
      throw new TransitionError(`unknown state: '${toState}'`);
    }
    if (!this.isValidTransition(fromState, toState)) {
      throw new TransitionError(
        `transition not allowed: '${fromState}' -> '${toState}'`
      );
    }
  }

  isTerminal(state: string): boolean {
    return this.terminalStates.has(state);
  }

  allowedNextStates(fromState: string): ReadonlySet<string> {
    const next = new Set<string>();
    for (const pair of this.transitionPairs) {
      const [src, dst] = pair.split("\u0000") as [string, string];
      if (src === fromState) next.add(dst);
    }
    return next;
  }
}
