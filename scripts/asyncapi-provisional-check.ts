/**
 * `asyncapi:provisional:check` -- gate for the PROVISIONAL cross-domain event
 * document (Issue #918 items 2-3).
 *
 * `asyncapi/provisional/awcms-cross-domain-events.provisional.asyncapi.yaml`
 * holds event schemas for modules that do not exist yet (booking, hr_payroll,
 * whatsapp_delivery). It is deliberately NOT part of the live contract: no
 * generator, parity test or api-reference doc reads it. Without a gate it would
 * be a second place events can quietly drift, so this check pins the rules:
 *
 * 1. The document is valid YAML, the same AsyncAPI version as the live file,
 *    and declares itself provisional (`info.x-awcms-status`).
 * 2. Its `DomainEventEnvelope` is IDENTICAL, as data, to the live one -- the
 *    envelope is the one thing that must not fork.
 * 3. Every channel name is `awcms.<area>.<entity>.<verb>` (exactly four
 *    lowercase segments), equals its `address`, is marked provisional, and
 *    references messages that exist, are provisional, and pin `eventType` to
 *    the channel name.
 * 4. Every `$ref` resolves inside the document.
 * 5. An event lives in EXACTLY ONE place: no provisional name may also be a
 *    live channel or a `DOMAIN_EVENT_TYPE_REGISTRY` entry. When a module's
 *    implementation PR adds the event to the live pair, it must delete it from
 *    the provisional file in the same PR, and this check is what forces that.
 * 6. Privacy: no payload property name contains a denied word (amounts, payment
 *    state, personal data, free text), and every payload schema is closed
 *    (`additionalProperties: false`).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";

export const PROVISIONAL_ASYNCAPI_PATH =
  "asyncapi/provisional/awcms-cross-domain-events.provisional.asyncapi.yaml";
const LIVE_ASYNCAPI_PATH = "asyncapi/awcms-domain-events.asyncapi.yaml";

const EVENT_NAME = /^awcms\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Words (camelCase-split) that may never be a payload property name. */
export const DENIED_PAYLOAD_WORDS: ReadonlySet<string> = new Set([
  "amount",
  "salary",
  "wage",
  "gross",
  "net",
  "rate",
  "price",
  "fee",
  "total",
  "balance",
  "deposit",
  "paid",
  "payment",
  "phone",
  "email",
  "name",
  "note",
  "reason",
  "body",
  "password",
  "secret",
  "token",
  "nik",
  "npwp"
]);

type AnyRecord = Record<string, unknown>;

export type ProvisionalCheckInput = {
  provisional: unknown;
  live: unknown;
  registryTypes: readonly string[];
};

function asRecord(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    node = asRecord(node)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) return undefined;
  }
  return node;
}

function collectRefs(node: unknown, found: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as AnyRecord)) {
      if (key === "$ref" && typeof value === "string") found.push(value);
      else collectRefs(value, found);
    }
  }
}

/** Property names declared anywhere under a payload schema (recursive). */
function collectPropertyNames(node: unknown, found: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPropertyNames(item, found);
    return;
  }
  const record = asRecord(node);
  for (const [key, value] of Object.entries(record)) {
    if (key === "properties") {
      for (const name of Object.keys(asRecord(value))) found.push(name);
    }
    collectPropertyNames(value, found);
  }
}

export function collectProvisionalProblems(
  input: ProvisionalCheckInput
): string[] {
  const problems: string[] = [];
  const doc = asRecord(input.provisional);
  const live = asRecord(input.live);

  if (doc.asyncapi !== live.asyncapi) {
    problems.push(
      `asyncapi version "${String(doc.asyncapi)}" differs from the live file's "${String(live.asyncapi)}".`
    );
  }
  const info = asRecord(doc.info);
  if (info["x-awcms-status"] !== "provisional") {
    problems.push('info.x-awcms-status must be "provisional".');
  }
  if (info["x-awcms-emitted-by-code"] !== false) {
    problems.push("info.x-awcms-emitted-by-code must be false.");
  }

  const schemas = asRecord(asRecord(doc.components).schemas);
  const liveSchemas = asRecord(asRecord(live.components).schemas);
  if (
    JSON.stringify(schemas.DomainEventEnvelope) !==
    JSON.stringify(liveSchemas.DomainEventEnvelope)
  ) {
    problems.push(
      "components.schemas.DomainEventEnvelope differs from the live envelope -- the envelope must not fork."
    );
  }

  const refs: string[] = [];
  collectRefs(doc, refs);
  for (const ref of new Set(refs)) {
    if (resolvePointer(doc, ref) === undefined) {
      problems.push(`$ref "${ref}" does not resolve inside the document.`);
    }
  }

  const liveChannels = new Set(Object.keys(asRecord(live.channels)));
  const registered = new Set(input.registryTypes);
  const channels = asRecord(doc.channels);

  if (Object.keys(channels).length === 0) {
    problems.push("The provisional document declares no channels.");
  }

  const payloadRefs = new Set<string>();

  for (const [name, rawChannel] of Object.entries(channels)) {
    const channel = asRecord(rawChannel);
    if (!EVENT_NAME.test(name)) {
      problems.push(
        `Channel "${name}" does not match awcms.<area>.<entity>.<verb>.`
      );
    }
    if (channel.address !== name) {
      problems.push(`Channel "${name}": address must equal the channel name.`);
    }
    if (channel["x-awcms-status"] !== "provisional") {
      problems.push(`Channel "${name}": x-awcms-status must be "provisional".`);
    }
    if (liveChannels.has(name)) {
      problems.push(
        `Channel "${name}" is already live in ${LIVE_ASYNCAPI_PATH} -- an event lives in exactly one place; remove it from the provisional file.`
      );
    }
    if (registered.has(name)) {
      problems.push(
        `Channel "${name}" is already in DOMAIN_EVENT_TYPE_REGISTRY -- remove it from the provisional file when it goes live.`
      );
    }

    const channelMessages = asRecord(channel.messages);
    if (Object.keys(channelMessages).length === 0) {
      problems.push(`Channel "${name}" declares no message.`);
    }
    for (const rawRef of Object.values(channelMessages)) {
      const ref = asRecord(rawRef).$ref;
      const message = asRecord(
        typeof ref === "string" ? resolvePointer(doc, ref) : undefined
      );
      if (Object.keys(message).length === 0) {
        problems.push(`Channel "${name}": message ${String(ref)} not found.`);
        continue;
      }
      if (message["x-awcms-status"] !== "provisional") {
        problems.push(
          `Message ${String(ref)}: x-awcms-status must be "provisional".`
        );
      }
      const allOf = asRecord(message.payload).allOf;
      const inline = Array.isArray(allOf)
        ? asRecord(allOf.find((part) => asRecord(part).type === "object"))
        : {};
      const props = asRecord(asRecord(inline).properties);
      if (asRecord(props.eventType).const !== name) {
        problems.push(
          `Message ${String(ref)}: payload must pin eventType to "${name}".`
        );
      }
      const payloadRef = asRecord(props.payload).$ref;
      if (typeof payloadRef === "string") payloadRefs.add(payloadRef);
      else
        problems.push(
          `Message ${String(ref)}: payload.payload must $ref a schema.`
        );
    }
  }

  for (const ref of payloadRefs) {
    const schema = asRecord(resolvePointer(doc, ref));
    if (schema.additionalProperties !== false) {
      problems.push(
        `${ref}: payload schema must set additionalProperties: false.`
      );
    }
    const names: string[] = [];
    collectPropertyNames(schema, names);
    for (const name of names) {
      const denied = words(name).filter((word) =>
        DENIED_PAYLOAD_WORDS.has(word)
      );
      if (denied.length > 0) {
        problems.push(
          `${ref}: property "${name}" contains denied word(s) ${denied.join(", ")} (amounts, payment state, personal data and free text never enter an event payload).`
        );
      }
    }
  }

  return problems;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const [provisionalRaw, liveRaw] = await Promise.all([
    readFile(path.resolve(root, PROVISIONAL_ASYNCAPI_PATH), "utf8"),
    readFile(path.resolve(root, LIVE_ASYNCAPI_PATH), "utf8")
  ]);
  const problems = collectProvisionalProblems({
    provisional: parseYaml(provisionalRaw),
    live: parseYaml(liveRaw),
    registryTypes: DOMAIN_EVENT_TYPE_REGISTRY.map((entry) => entry.eventType)
  });
  if (problems.length > 0) {
    console.error(
      `asyncapi:provisional:check failed -- ${problems.length} issue(s):`
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("asyncapi:provisional:check passed.");
}

if (import.meta.main) {
  await main();
}
