/**
 * Template registry for `telegram_delivery` (Issue #965, ADR-0140 section 1).
 *
 * The refusal of payroll, personal data, customer-facing, `security` and
 * marketing traffic is enforced by what this file CAN express, not by caller
 * discipline:
 *
 * 1. **One purpose exists.** A template declares `purpose: "staff_ops"`; no other
 *    value is representable, so there is nothing to select by mistake.
 * 2. **Variables are typed, and no kind can carry free text.** The four kinds
 *    below (`reference`, `count`, `token`, `link`) each validate against a narrow
 *    pattern. There is no `text`, `name`, `amount` or `address` kind, so a
 *    record's free text cannot be passed through however a caller spells it.
 * 3. **A deny list fails REGISTRATION, not send time**: a variable whose name
 *    reads as a person name, phone, e-mail, address, identifier, amount, or
 *    free text taken from a record is refused when the template is registered.
 * 4. **A payroll-bearing module cannot register at all.** Ownership is a
 *    DECLARATION (`ModuleDescriptor.handlesPayrollData`), not a guess from a
 *    name, and a template's key prefix must equal the module that registers it,
 *    so a template cannot borrow a harmless-looking prefix. Fixed wording that
 *    reads as payroll is refused too. `bun run telegram:templates:check` fails
 *    CI if a flagged module's source touches the Telegram port at all. All of
 *    this is a HEURISTIC GATE, not a proof (a static scan is blind to a string
 *    built at runtime, which is why rule 5 exists, and a payroll module that
 *    does not declare itself is a review finding).
 * 5. **The port takes a template key and allow-listed variables only**, never a
 *    free-text body. A value that does not satisfy its kind is DROPPED by the
 *    renderer, like a variable that is not on the list.
 *
 * Fixed wording may not carry a URL, a bare domain or an `@` mention: the
 * same-origin `link` variable is the only URL a message can contain.
 *
 * The registry is code, not rows. Consuming modules call
 * `registerTelegramTemplate` from their own module scope with a
 * module-prefixed key (`booking.staff_reminder`, `workflow_approval.approval_pending`).
 * This module ships only the neutral `system.ops_alert`.
 */
import { listModules } from "../../index";
import {
  TELEGRAM_MODULE_KEY,
  TELEGRAM_PURPOSE,
  type TelegramPurpose
} from "./telegram-constants";

export type TelegramVariableKind = "reference" | "count" | "token" | "link";

export const TELEGRAM_VARIABLE_KINDS: readonly TelegramVariableKind[] = [
  "reference",
  "count",
  "token",
  "link"
];

export type TelegramVariableDefinition = {
  /** camelCase or snake_case; checked against the deny list at registration. */
  name: string;
  kind: TelegramVariableKind;
};

export type TelegramTemplateDefinition = {
  /**
   * The module that registers this template (`ModuleDescriptor.key`). It must be
   * a registered module that does not declare `handlesPayrollData`, and the
   * key's prefix must equal it (`telegram_delivery` also owns `system.*`).
   */
  ownerModuleKey: string;
  /** `<module>.<name>`, lower-case snake segments; the prefix is the owner's key. */
  key: string;
  /** Bumped when wording or variables change; stored on the queue row. */
  version: number;
  purpose: TelegramPurpose;
  /** Fixed wording with `{{variable}}` placeholders. Plain text: no markup is ever sent. */
  body: string;
  /** The variable allow-list. Anything else a caller supplies is dropped. */
  variables: readonly TelegramVariableDefinition[];
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const VARIABLE_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/;
/** Telegram caps a message at 4096 characters; the cap here is far below it. */
export const MAX_TELEGRAM_BODY_LENGTH = 1000;
const MAX_LINK_LENGTH = 200;

/**
 * Words (camelCase and snake_case split) a variable name may not contain. They
 * name the kinds of data ADR-0140 section 1 refuses: a person, a contact detail,
 * an address, an identifier, an amount, or free text taken from a record.
 */
export const DENIED_VARIABLE_WORDS: ReadonlySet<string> = new Set([
  "name",
  "fullname",
  "firstname",
  "lastname",
  "person",
  "employee",
  "customer",
  "guest",
  "patient",
  "client",
  "member",
  "phone",
  "mobile",
  "tel",
  "telephone",
  "whatsapp",
  "email",
  "mail",
  "address",
  "street",
  "city",
  "postcode",
  "zip",
  "location",
  "nik",
  "npwp",
  "ktp",
  "passport",
  "ssn",
  "dob",
  "birthdate",
  "birthday",
  "gender",
  "bank",
  "account",
  "iban",
  "card",
  "amount",
  "total",
  "price",
  "fee",
  "cost",
  "salary",
  "wage",
  "pay",
  "payroll",
  "payslip",
  "balance",
  "tax",
  "text",
  "note",
  "notes",
  "comment",
  "comments",
  "message",
  "body",
  "description",
  "reason",
  "remark",
  "content",
  "subject",
  "title",
  "otp",
  "identifier",
  "password",
  "pin",
  "token",
  "secret",
  // Pay, in English: synonyms and the plurals the singular list above misses.
  "wages",
  "salaries",
  "payee",
  "gross",
  "net",
  "commission",
  "bonus",
  "payout",
  "remuneration",
  "compensation",
  "earnings",
  "income",
  "deduction",
  "overtime",
  "allowance",
  "stipend",
  "invoice",
  // Indonesian: person, contact, address, identifier, money and free text.
  "nama",
  "alamat",
  "telp",
  "telepon",
  "hp",
  "gaji",
  "upah",
  "tunjangan",
  "lembur",
  "potongan",
  "pajak",
  "rekening",
  "komisi",
  "pegawai",
  "karyawan",
  "pelanggan",
  "tamu",
  "pasien",
  "catatan",
  "pesan",
  "alasan",
  "keterangan",
  "judul",
  "surel",
  "kata",
  "sandi"
]);

/**
 * A template under one of these modules is refused outright (ADR-0140 section 1,
 * ADR-0133 section 7, ADR-0132): payroll notices go only on the channel the
 * tenant chose for them, never here. Checked against the key's module prefix.
 */
export function isPayrollOwningKeyPrefix(modulePrefix: string): boolean {
  return PAYROLL_NAME_FRAGMENT.test(modulePrefix);
}

/**
 * A SECOND, coarser line behind the declared flag: a key segment that spells a
 * payroll word is refused whatever module claims to own it. `hr.payslip_ready`
 * fails here even though `hr` is not a module; `hr_commission.statement_ready`
 * fails on the owner's declared flag, and on this when the flag is forgotten.
 */
const PAYROLL_NAME_FRAGMENT =
  /payroll|payslip|salary|salaries|wage|commission|gaji|upah|komisi|remuneration|payout|bonus|thr\b/;

/**
 * Wording that reads as payroll. Applied to a template's FIXED text (the
 * placeholders are stripped first): no registered template may talk about pay,
 * whichever module registers it. Whole words, case-insensitive.
 */
const PAYROLL_WORDING =
  /\b(payroll|payslips?|pay\s*slips?|salary|salaries|wages?|gross\s+pay|net\s+pay|take-home|commissions?|bonus(?:es)?|payouts?|remuneration|compensation|earnings?|pay|paid|payable|payments?|statements?|slips?|gaji|upah|slip\s+gaji|komisi|tunjangan|lembur|pembayaran|bayar(?:an)?|insentif|imbalan|honor(?:arium)?|penghasilan|incentives?|thr)\b/i;

/** The payroll word fixed wording contains, or `null`. Exported for the registry gate. */
export function payrollWordInWording(wording: string): string | null {
  const match = PAYROLL_WORDING.exec(wording);

  return match ? match[1]!.toLowerCase() : null;
}

/** A key's `<module>` prefix, or `""` when it has none. */
export function templateKeyPrefix(key: string): string {
  const dot = key.indexOf(".");

  return dot === -1 ? "" : key.slice(0, dot);
}

/** A key's `<name>` part, or `""`. */
function templateKeyName(key: string): string {
  const dot = key.indexOf(".");

  return dot === -1 ? "" : key.slice(dot + 1);
}

function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** The word itself plus its plural-stripped forms (`names` -> `name`, `salaries` -> `salary`). */
function wordForms(word: string): string[] {
  const forms = [word];

  if (word.endsWith("ies") && word.length > 4) {
    forms.push(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("es") && word.length > 3) {
    forms.push(word.slice(0, -2));
  }

  if (word.endsWith("s") && word.length > 2) {
    forms.push(word.slice(0, -1));
  }

  return forms;
}

/** The denied word a variable name contains, or `null`. Exported for the registry gate. */
export function deniedWordInVariableName(name: string): string | null {
  const words = splitWords(name);

  for (const word of words) {
    for (const form of wordForms(word)) {
      if (DENIED_VARIABLE_WORDS.has(form)) {
        return form;
      }
    }
  }

  // `jobname`, `firstname` etc. written as one word.
  const joined = words.join("");

  for (const denied of DENIED_VARIABLE_WORDS) {
    if (denied.length >= 5 && joined.includes(denied)) {
      return denied;
    }
  }

  return null;
}

export class TelegramTemplateRegistrationError extends Error {}

const registry = new Map<string, TelegramTemplateDefinition>();

function sameDefinition(
  a: TelegramTemplateDefinition,
  b: TelegramTemplateDefinition
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Fixed wording may carry no URL, bare domain or mention (the link variable is the only URL). */
const FORBIDDEN_WORDING =
  /(https?:\/\/|www\.|\bt\.me\b|[a-z0-9-]+\.(?:com|net|org|io|id|co)\b|@\w)/i;

/** What the registry needs to know about a module to admit its template. */
export type TelegramTemplateOwner = {
  key: string;
  handlesPayrollData?: boolean;
};

export type RegisterTelegramTemplateOptions = {
  /** The registered modules. Defaults to the live module registry (`listModules()`); a test seam. */
  owners?: () => readonly TelegramTemplateOwner[];
};

/**
 * The live module registry, read at REGISTRATION time and never at import time
 * (the built-ins below skip it), so evaluation order cannot matter. If the
 * registry cannot be read yet (an import cycle), the read throws and the
 * registration fails closed rather than admitting an unknown owner.
 */
const liveOwners = (): readonly TelegramTemplateOwner[] => listModules();

/** The extra prefixes a module may own: the neutral built-ins live under `system.*`. */
const EXTRA_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  [TELEGRAM_MODULE_KEY]: ["system"]
};

export function registerTelegramTemplate(
  definition: TelegramTemplateDefinition,
  options: RegisterTelegramTemplateOptions = {}
): void {
  if (!KEY_PATTERN.test(definition.key)) {
    throw new TelegramTemplateRegistrationError(
      `Template key "${definition.key}" must be <module>.<name> in lower-case snake case.`
    );
  }

  const modulePrefix = templateKeyPrefix(definition.key);

  // The key's prefix is the OWNER's key: a template cannot borrow another
  // module's namespace, nor a harmless-looking one.
  const allowedPrefixes = [
    definition.ownerModuleKey,
    ...(EXTRA_PREFIXES[definition.ownerModuleKey] ?? [])
  ];

  if (!allowedPrefixes.includes(modulePrefix)) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" must be prefixed with its registering module's key "${definition.ownerModuleKey}".`
    );
  }

  if (
    isPayrollOwningKeyPrefix(modulePrefix) ||
    PAYROLL_NAME_FRAGMENT.test(templateKeyName(definition.key))
  ) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" reads as payroll; payroll notices never go to Telegram (ADR-0140 section 1).`
    );
  }

  // The built-ins are this module's own and are registered at import time,
  // before the module registry is guaranteed to be readable.
  if (definition.ownerModuleKey !== TELEGRAM_MODULE_KEY) {
    const owner = (options.owners ?? liveOwners)().find(
      (entry) => entry.key === definition.ownerModuleKey
    );

    if (!owner) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" names owner module "${definition.ownerModuleKey}", which is not a registered module.`
      );
    }

    if (owner.handlesPayrollData) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" is registered by module "${owner.key}", which declares it handles payroll data; payroll notices never go to Telegram (ADR-0140 section 1).`
      );
    }
  }

  if (definition.purpose !== TELEGRAM_PURPOSE) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" must declare purpose "${TELEGRAM_PURPOSE}"; it is the only class this adapter carries.`
    );
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" needs a positive integer version.`
    );
  }

  if (
    definition.body.length === 0 ||
    definition.body.length > MAX_TELEGRAM_BODY_LENGTH
  ) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" body must be 1..${MAX_TELEGRAM_BODY_LENGTH} characters.`
    );
  }

  const seen = new Set<string>();

  for (const variable of definition.variables) {
    if (!VARIABLE_NAME_PATTERN.test(variable.name)) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" has an invalid variable name "${variable.name}".`
      );
    }

    if (seen.has(variable.name)) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" declares variable "${variable.name}" twice.`
      );
    }

    seen.add(variable.name);

    if (!TELEGRAM_VARIABLE_KINDS.includes(variable.kind)) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" variable "${variable.name}" has an unknown kind; only ${TELEGRAM_VARIABLE_KINDS.join(", ")} are admitted.`
      );
    }

    const denied = deniedWordInVariableName(variable.name);

    if (denied !== null) {
      throw new TelegramTemplateRegistrationError(
        `Template "${definition.key}" variable "${variable.name}" reads as "${denied}", a kind of data Telegram never carries (ADR-0140 section 1).`
      );
    }
  }

  // Placeholders must name declared variables, and the fixed wording around
  // them must carry no URL of its own.
  const wording = definition.body.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_match, name: string) => {
      if (!seen.has(name)) {
        throw new TelegramTemplateRegistrationError(
          `Template "${definition.key}" uses placeholder "${name}" that is not on its variable list.`
        );
      }

      return " ";
    }
  );

  const payrollWord = payrollWordInWording(wording);

  if (payrollWord !== null) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" wording contains the payroll term "${payrollWord}"; payroll notices never go to Telegram (ADR-0140 section 1).`
    );
  }

  if (FORBIDDEN_WORDING.test(wording)) {
    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" wording contains a URL, domain or mention; the same-origin link variable is the only URL a message may carry.`
    );
  }

  const existing = registry.get(definition.key);

  if (existing) {
    // Re-registration of the identical definition is a no-op (a module imported
    // twice). A DIFFERENT definition under the same key is a conflict.
    if (sameDefinition(existing, definition)) {
      return;
    }

    throw new TelegramTemplateRegistrationError(
      `Template "${definition.key}" is already registered with a different definition.`
    );
  }

  registry.set(
    definition.key,
    Object.freeze({
      ...definition,
      variables: Object.freeze([...definition.variables])
    })
  );
}

export function getTelegramTemplate(
  key: string
): TelegramTemplateDefinition | undefined {
  return registry.get(key);
}

export function listTelegramTemplates(): TelegramTemplateDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Test seam only. */
export function resetTelegramTemplatesForTests(): void {
  registry.clear();
  registerBuiltInTemplates();
}

// Opaque references: a reservation code, a job key. No dot, so a value can never
// read as a domain that a client would linkify; no slash or colon-slash, so no URL.
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COUNT_PATTERN = /^\d{1,6}$/;
// A finite machine token such as a job name (`email:dispatch`).
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
// A same-origin path to an authenticated admin page; the origin is added at render.
const LINK_PATTERN = /^\/admin\/[A-Za-z0-9/_\-.?=&%]{0,180}$/;

export function isValidTelegramVariableValue(
  kind: TelegramVariableKind,
  value: unknown
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  switch (kind) {
    case "reference":
      // Not digits alone from 8 up: that is the shape of a phone number, a
      // national id or an account number, and an opaque reference never needs it.
      return REFERENCE_PATTERN.test(value) && !/^\d{8,}$/.test(value);
    case "count":
      return COUNT_PATTERN.test(value);
    case "token":
      return TOKEN_PATTERN.test(value);
    case "link":
      return (
        value.length <= MAX_LINK_LENGTH &&
        LINK_PATTERN.test(value) &&
        !value.includes("..") &&
        !value.includes("//")
      );
  }
}

export type RenderedTelegramMessage = {
  /** The final plain text, at most `MAX_TELEGRAM_BODY_LENGTH` characters. */
  body: string;
  /** The variables that survived the allow-list and their kind check, as stored on the row. */
  variables: Record<string, string>;
  /** Names the caller supplied that the allow-list dropped. Reported by NAME only, never stored. */
  droppedVariables: string[];
};

/**
 * Renders a template. `siteBaseUrl` is the operator-declared origin
 * (`APP_URL`, via `resolveDeclaredBaseUrl`): a `link` variable is a path, and
 * only this origin is ever prepended, so a message cannot point anywhere else.
 */
export function renderTelegramTemplate(
  template: TelegramTemplateDefinition,
  supplied: Record<string, unknown>,
  siteBaseUrl: string
): RenderedTelegramMessage {
  const declared = new Map(
    template.variables.map((variable) => [variable.name, variable] as const)
  );
  const variables: Record<string, string> = {};
  const droppedVariables: string[] = [];

  for (const [name, value] of Object.entries(supplied ?? {})) {
    const definition = declared.get(name);

    if (definition && isValidTelegramVariableValue(definition.kind, value)) {
      variables[name] = value;
    } else {
      droppedVariables.push(name);
    }
  }

  const body = template.body
    .replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (_match, name: string) => {
        const value = variables[name];

        if (value === undefined) {
          return "";
        }

        return declared.get(name)?.kind === "link"
          ? new URL(value, siteBaseUrl).toString()
          : value;
      }
    )
    .trim();

  return {
    body: body.slice(0, MAX_TELEGRAM_BODY_LENGTH),
    variables,
    droppedVariables
  };
}

function registerBuiltInTemplates(): void {
  // The one neutral template this module ships (ADR-0140 section 1, "Operational
  // alert"). Business wording belongs to the module that owns the event.
  registerTelegramTemplate({
    ownerModuleKey: TELEGRAM_MODULE_KEY,
    key: "system.ops_alert",
    version: 1,
    purpose: TELEGRAM_PURPOSE,
    body: "Job {{job}} has failed {{failures}} runs. Open the admin to view: {{link}}",
    variables: [
      { name: "job", kind: "token" },
      { name: "failures", kind: "count" },
      { name: "link", kind: "link" }
    ]
  });

  // Sent once, through the normal queue, when a staff member confirms their chat
  // (ADR-0140 audit M5): the chat learns which tenant it is now tied to and how
  // to leave, so a chat bound by a forwarded code cannot stay silent about it.
  registerTelegramTemplate({
    ownerModuleKey: TELEGRAM_MODULE_KEY,
    key: "system.binding_activated",
    version: 1,
    purpose: TELEGRAM_PURPOSE,
    body: "Alerts for {{tenant}} are now enabled for this chat. Send /stop here to stop them. / Notifikasi untuk {{tenant}} kini aktif untuk chat ini. Kirim /stop di sini untuk menghentikannya.",
    variables: [{ name: "tenant", kind: "reference" }]
  });
}

registerBuiltInTemplates();
