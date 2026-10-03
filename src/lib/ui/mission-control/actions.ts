/**
 * Contextual actions for the 3D Mission Control workspace (Issue
 * ahliweb/omes#267, epic ahliweb/omes#263, ADR-0031 rule 3). Lazily `import()`ed
 * by `controller.ts` the first time an object is selected in LIVE mode, so a
 * viewer who never selects anything — and History mode, which has no actions at
 * all — downloads none of it.
 *
 * ## A shortcut to existing endpoints, never a second path
 *
 * Nothing here executes, schedules or approves anything. An action is a button
 * that sends the EXACT request the canonical screen already sends to the
 * EXISTING endpoint (`POST /api/v1/omes/operations` with `{ serverId, operation,
 * deploymentId? }`; `POST /jobs/{id}/cancel|approve`; `POST
 * /backups/{id}/restore`) with a fresh `Idempotency-Key`. Those endpoints
 * re-authorize, rate-limit, apply the destructive-workflow gate, audit and
 * deduplicate; the availability fetched from `GET .../actions` is ADVISORY and
 * only decides which buttons are enabled and what the user is told. The path
 * and body the server suggests are re-validated here against a closed
 * allowlist, so even a tampered response cannot make this module call anything
 * else.
 *
 * ## Results are never conflated
 *
 * `accepted` (recorded, pending verification), `approval_required` (a workflow
 * decision is needed — made ONLY in the canonical inbox, never here),
 * `rejected` and `unknown` (timeout, network, 5xx — never shown as success).
 * The scene is never changed optimistically; the next poll reflects reality.
 * No free-form field exists: no shell, argv, URL or tool input.
 *
 * ## Idempotency
 *
 * One `Idempotency-Key` per user INTENT (action + target), generated when the
 * preflight panel opens, shown in it, and reused if the user retries the same
 * intent after a failed or uncertain attempt; dropped once the server accepted
 * it (or the user backed out before sending).
 *
 * Every server value (labels, ids, reasons) is written with `textContent` —
 * never `innerHTML`.
 */
import {
  MISSION_CONTROL_ACTIONS_API,
  type MissionControlSceneNode
} from "../../../modules/omes-control/domain/mission-control-types";
import {
  mapMutationOutcome,
  workflowInstanceIdOf,
  type MissionControlMutationOutcome
} from "../../../modules/omes-control/domain/mission-control-outcome";
import { confirmAction } from "../confirm-dialog-client";
import { el, fill } from "./vocab";

type Dict = Record<string, string>;
export type ActionLabels = {
  names?: Dict;
  reasons?: Dict;
  advisories?: Dict;
  ui?: Dict;
};

/** One entry of `GET .../actions`, validated. */
export type ActionItem = {
  action: string;
  available: boolean;
  reason: string;
  requiresApproval: boolean;
  mutating: boolean;
  path: string;
  advisories: string[];
  body?: { serverId: string; operation: string; deploymentId?: string };
};

const BODY_KEYS = new Set(["serverId", "operation", "deploymentId"]);
/** The ONLY mutation endpoints this module may call (all existing). */
const MUTATION_PATH =
  /^\/api\/v1\/omes\/(operations|jobs\/[A-Za-z0-9-]{1,64}\/(cancel|approve)|backups\/[A-Za-z0-9-]{1,64}\/restore)$/;
const INBOX_PATH = /^\/admin\/approvals\?workflowKey=[A-Za-z0-9_.-]+&instance=/;
const INBOX = "/admin/approvals?workflowKey=omes_control.destructive_operation";
const TIMEOUT_MS = 15_000;

/** Where an accepted/unknown request can be inspected (canonical screens). */
export function recordLink(item: ActionItem): string {
  if (item.action.startsWith("job.")) return "/admin/omes/jobs";
  if (item.action === "backup.restore") return "/admin/omes/backups";
  return item.body
    ? `/admin/omes/operations?serverId=${encodeURIComponent(item.body.serverId)}`
    : "/admin/omes/operations";
}

/**
 * Validates one server-suggested action. Anything off-allowlist is dropped
 * (fail closed): the UI then simply does not offer it.
 */
export function parseAction(raw: unknown): ActionItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.action !== "string" ||
    typeof a.available !== "boolean" ||
    typeof a.reason !== "string" ||
    typeof a.path !== "string"
  ) {
    return null;
  }
  const mutating = a.mutating === true;
  const item: ActionItem = {
    action: a.action,
    available: a.available,
    reason: a.reason,
    requiresApproval: a.requires_approval === true,
    mutating,
    path: a.path,
    advisories: Array.isArray(a.advisories)
      ? a.advisories.filter((x): x is string => typeof x === "string")
      : []
  };
  if (a.body !== undefined) {
    // Exactly the Operations screen's body: serverId, operation, optional
    // deploymentId — nothing free-form (the endpoint validates the values).
    const b = a.body as Record<string, unknown> | null;
    if (
      typeof b !== "object" ||
      b === null ||
      Object.keys(b).some((k) => !BODY_KEYS.has(k)) ||
      Object.values(b).some((v) => typeof v !== "string") ||
      typeof b.serverId !== "string" ||
      typeof b.operation !== "string"
    ) {
      return null;
    }
    item.body = b as ActionItem["body"];
  }
  if (mutating) {
    if (!MUTATION_PATH.test(item.path)) return null;
    // An operation request needs its body; job / backup requests have none.
    if (item.path.endsWith("/operations") !== (item.body !== undefined)) {
      return null;
    }
  } else if (
    item.action === "approval.open_in_inbox" &&
    !INBOX_PATH.test(item.path)
  ) {
    return null;
  }
  return item;
}

/** One Idempotency-Key per intent; reused until the server accepted it. */
export type IntentStore = Map<string, { key: string; sent: boolean }>;

export function intentKey(
  store: IntentStore,
  intent: string,
  generate: () => string = () => crypto.randomUUID()
): string {
  let entry = store.get(intent);
  if (!entry) {
    entry = { key: generate(), sent: false };
    store.set(intent, entry);
  }
  return entry.key;
}

/** What to tell the user, and where to send them, for one outcome. */
export type OutcomeView = {
  /** Key of the translated sentence (`ui[message]`). */
  message:
    | "accepted"
    | "approval_required"
    | "approval_not_configured"
    | "rejected"
    | "unknown";
  /** Canonical screen to continue in (record, or the approval inbox), if any. */
  href: string | null;
  /** Key of the translated link text (`ui[link]`). */
  link: "openRecord" | "openInbox" | null;
  /** Keep the Idempotency-Key so a retry of the same intent reuses it. */
  keepIntent: boolean;
};

export function describeOutcome(
  outcome: MissionControlMutationOutcome,
  item: ActionItem,
  body: unknown
): OutcomeView {
  if (outcome === "accepted") {
    return {
      message: "accepted",
      href: recordLink(item),
      link: "openRecord",
      keepIntent: false
    };
  }
  if (outcome === "approval_required") {
    const instance = workflowInstanceIdOf(body);
    return {
      message: instance ? "approval_required" : "approval_not_configured",
      href: instance
        ? `${INBOX}&instance=${encodeURIComponent(instance)}`
        : INBOX,
      link: "openInbox",
      // A started workflow instance means the request was recorded; "not
      // configured" recorded nothing, so a retry is the same intent.
      keepIntent: !instance
    };
  }
  // rejected / unknown keep the key: a retry is the same intent, and a request
  // the server DID record is deduplicated under that key.
  return {
    message: outcome,
    href: outcome === "unknown" ? recordLink(item) : null,
    link: outcome === "unknown" ? "openRecord" : null,
    keepIntent: true
  };
}

export type ActionsHost = {
  root: HTMLElement;
  labels: ActionLabels;
  isLive: () => boolean;
};
export type ActionsApi = {
  show: (node: MissionControlSceneNode) => void;
  clear: () => void;
};

export function startActions(host: ActionsHost): ActionsApi {
  const { root, labels } = host;
  const ui = labels.ui ?? {};
  const word = (map: Dict | undefined, key: string): string =>
    map?.[key] ?? key;
  const listEl = root.querySelector<HTMLElement>("[data-actions-list]");
  const panelEl = root.querySelector<HTMLElement>("[data-actions-panel]");
  const resultEl = root.querySelector<HTMLElement>("[data-actions-result]");
  const intents: IntentStore = new Map();
  let current: MissionControlSceneNode | null = null;
  let abort: AbortController | null = null;
  let seq = 0;
  let busy = false;

  function say(text: string, href?: string | null, linkText?: string): void {
    if (!resultEl) return;
    resultEl.replaceChildren(document.createTextNode(text));
    if (href) {
      const link = el("a", "omes-mc-link", linkText ?? "");
      link.href = href;
      resultEl.append(" ", link);
    }
    resultEl.hidden = false;
  }

  function closePanel(): void {
    if (panelEl) {
      panelEl.replaceChildren();
      panelEl.hidden = true;
    }
    // Backing out before anything was sent forgets the intent's key.
    for (const [intent, entry] of intents)
      if (!entry.sent) intents.delete(intent);
  }

  function clear(): void {
    abort?.abort();
    seq += 1;
    current = null;
    if (busy) return;
    closePanel();
    listEl?.replaceChildren();
    if (resultEl) {
      resultEl.replaceChildren();
      resultEl.hidden = true;
    }
    root.hidden = true;
  }

  async function send(
    item: ActionItem,
    key: string,
    node: MissionControlSceneNode
  ): Promise<void> {
    const entry = intents.get(intentOf(node, item));
    if (entry) entry.sent = true;
    const guard = new AbortController();
    const timer = window.setTimeout(() => guard.abort(), TIMEOUT_MS);
    let status: number | "network_error" | "timeout" = "network_error";
    let payload: unknown = null;
    try {
      const headers: Record<string, string> = { "Idempotency-Key": key };
      if (item.body) headers["Content-Type"] = "application/json";
      const response = await fetch(item.path, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: item.body ? JSON.stringify(item.body) : undefined,
        signal: guard.signal
      });
      status = response.status;
      payload = await response.json().catch(() => null);
    } catch {
      status = guard.signal.aborted ? "timeout" : "network_error";
    } finally {
      window.clearTimeout(timer);
    }
    const outcome = mapMutationOutcome(status, payload);
    const view = describeOutcome(outcome, item, payload);
    const code =
      typeof status === "number" &&
      typeof (payload as { error?: { code?: unknown } } | null)?.error?.code ===
        "string"
        ? String((payload as { error: { code: string } }).error.code)
        : "";
    const text = fill(ui[view.message], {
      status: String(status),
      code: /^[A-Z_]{1,64}$/.test(code) ? code : "-"
    });
    say(
      `${word(labels.names, item.action)} — ${node.label}: ${text}`,
      view.href,
      view.link ? ui[view.link] : undefined
    );
    if (!view.keepIntent) intents.delete(intentOf(node, item));
  }

  function intentOf(node: MissionControlSceneNode, item: ActionItem): string {
    return `${node.kind}\u0000${node.source_id}\u0000${item.action}`;
  }

  function openPreflight(
    item: ActionItem,
    node: MissionControlSceneNode
  ): void {
    if (!panelEl || !host.isLive()) return;
    const key = intentKey(intents, intentOf(node, item));
    const rows: Array<[string, string]> = [
      [ui.operation ?? "", word(labels.names, item.action)],
      [ui.target ?? "", `${node.kind} · ${node.source_id} · ${node.label}`],
      [ui.permission ?? "", ui.permissionOk ?? ""],
      [
        ui.approval ?? "",
        item.requiresApproval ? (ui.approvalYes ?? "") : (ui.approvalNo ?? "")
      ],
      [ui.endpoint ?? "", `POST ${item.path}`],
      [ui.key ?? "", key]
    ];
    const dl = el("dl", "omes-mc-hud-fields");
    for (const [name, value] of rows) {
      const wrap = el("div");
      const dd = el(
        "dd",
        name === ui.key || name === ui.endpoint ? "cell-code" : "",
        value
      );
      wrap.append(el("dt", undefined, name), dd);
      dl.append(wrap);
    }
    const warnings = item.advisories.map((a) =>
      el("p", "omes-mc-warning", `⚠ ${word(labels.advisories, a)}`)
    );
    const send_ = el("button", "btn btn-primary", ui.send ?? "");
    send_.type = "button";
    const cancel = el("button", "btn btn-secondary", ui.cancel ?? "");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      if (!busy) closePanel();
    });
    send_.addEventListener("click", async () => {
      if (busy || !host.isLive()) return;
      if (item.requiresApproval || item.action.startsWith("job.")) {
        const ok = await confirmAction(
          fill(ui.confirm, {
            action: word(labels.names, item.action),
            target: node.label
          })
        );
        if (!ok) return;
      }
      busy = true;
      send_.disabled = cancel.disabled = true;
      send_.textContent = ui.sending ?? "";
      try {
        await send(item, key, node);
      } finally {
        busy = false;
        send_.disabled = cancel.disabled = false;
        send_.textContent = ui.send ?? "";
      }
      if (!intents.has(intentOf(node, item))) closePanel();
      if (current && current.source_id === node.source_id) void load(node);
    });
    const buttons = el("div", "omes-mc-transport");
    buttons.append(send_, cancel);
    panelEl.replaceChildren(
      el("h4", "omes-mc-zone-title", ui.preflight ?? ""),
      dl,
      ...warnings,
      buttons
    );
    panelEl.hidden = false;
    send_.focus();
  }

  function render(items: ActionItem[], node: MissionControlSceneNode): void {
    if (!listEl) return;
    const rows = items
      .filter((item) => item.action !== "open_details")
      .map((item) => {
        const li = el("li", "omes-mc-action");
        const name = word(labels.names, item.action);
        let control: HTMLElement;
        if (item.action === "approval.open_in_inbox" && item.available) {
          const link = el("a", "btn btn-secondary", name);
          link.href = item.path;
          control = link;
        } else {
          const btn = el("button", "btn btn-secondary", name);
          btn.type = "button";
          btn.disabled = !item.available || !item.mutating;
          if (item.available && item.mutating) {
            btn.addEventListener("click", () => openPreflight(item, node));
          }
          control = btn;
        }
        li.append(control);
        if (item.requiresApproval) {
          li.append(el("span", "omes-mc-badge", ui.approvalBadge ?? ""));
        }
        if (!item.available) {
          li.append(
            el("span", "cell-muted", word(labels.reasons, item.reason))
          );
        }
        for (const a of item.advisories) {
          li.append(
            el("span", "omes-mc-warning", `⚠ ${word(labels.advisories, a)}`)
          );
        }
        return li;
      });
    listEl.replaceChildren(...rows);
    if (rows.length === 0) {
      listEl.append(el("li", "cell-muted", ui.none ?? ""));
    }
  }

  async function load(node: MissionControlSceneNode): Promise<void> {
    abort?.abort();
    const mine = (seq += 1);
    const guard = (abort = new AbortController());
    const timer = window.setTimeout(() => guard.abort(), 10_000);
    try {
      const url = `${MISSION_CONTROL_ACTIONS_API}?${new URLSearchParams({
        kind: node.kind,
        id: node.source_id
      })}`;
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        signal: guard.signal
      });
      if (!response.ok) throw new Error("actions failed");
      const body = (await response.json()) as {
        data?: { actions?: { actions?: unknown[] } };
      };
      const raw = body.data?.actions?.actions;
      if (!Array.isArray(raw)) throw new Error("malformed actions");
      if (mine !== seq || !host.isLive()) return;
      render(
        raw.flatMap((r) => {
          const item = parseAction(r);
          return item ? [item] : [];
        }),
        node
      );
    } catch {
      if (mine !== seq) return;
      listEl?.replaceChildren(el("li", "cell-muted", ui.loadFailed ?? ""));
    } finally {
      window.clearTimeout(timer);
    }
  }

  return {
    show(node) {
      if (!host.isLive()) return clear();
      const same =
        current?.kind === node.kind && current.source_id === node.source_id;
      current = node;
      root.hidden = false;
      if (!same) {
        if (!busy) closePanel();
        listEl?.replaceChildren(el("li", "cell-muted", ui.loading ?? ""));
        if (resultEl && !busy) {
          resultEl.replaceChildren();
          resultEl.hidden = true;
        }
      }
      void load(node);
    },
    clear
  };
}
