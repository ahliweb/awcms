/**
 * A minimal, dependency-free JSON Schema (draft 2020-12 subset) validator
 * with fail-closed schema keyword validation (Issue ahliweb/omes#197,
 * parent #195, ADR-0122).
 *
 * Why this exists: AWCMS ships no `ajv`/`zod`/other JSON Schema dependency
 * (the manager decision for #197 is explicit: no new dependency), and OMES
 * itself is Python-stdlib-only for the identical reason (ADR-0012,
 * `lib/omes/py/jobs/schema.py`, issues #89/#90/#172). This module is a
 * line-for-line TypeScript port of that validator's semantics — same
 * supported keyword allowlist, same fail-closed behaviour on any other
 * keyword, same independent raw-secret scanner — so AWCMS enforces exactly
 * what OMES enforces on the OMES side of the same contract, never a weaker
 * subset.
 *
 * Supported validation keywords:
 *
 *   type, required, properties, additionalProperties, enum, const,
 *   pattern, minimum, maximum, minLength, maxLength, minItems, maxItems,
 *   items, oneOf, anyOf
 *
 * Allowlisted metadata-only annotations:
 *
 *   $schema, $id, title, description
 *
 * Any other JSON Schema keyword ($ref, format, if/then/else, allOf, not,
 * uniqueItems, patternProperties, ...) makes `validateSchema` throw a
 * `SchemaError` naming the exact path and keyword — fail closed, matching
 * issue #172's contract.
 */

export const SUPPORTED_VALIDATION_KEYWORDS = new Set([
  "type",
  "required",
  "properties",
  "additionalProperties",
  "enum",
  "const",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "items",
  "oneOf",
  "anyOf"
] as const);

export const ALLOWED_ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description"
] as const);

const ALLOWED_SCHEMA_KEYWORDS = new Set<string>([
  ...SUPPORTED_VALIDATION_KEYWORDS,
  ...ALLOWED_ANNOTATION_KEYWORDS
]);

/** Raised for a malformed schema — a contract bug, or an unsupported/unknown keyword. */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Raised by `validateOmesContractInstance()` with every collected failure reason. */
export class ContractValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.length > 0 ? errors.join("; ") : "validation failed");
    this.name = "ContractValidationError";
    this.errors = errors;
  }
}

// A JSON value. `unknown` at the leaves so callers must narrow, same as any
// hand-rolled JSON Schema validator without a codegen step.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  enum?: JsonValue[];
  const?: JsonValue;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema | JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively inspects `schema` to ensure every keyword is in the
 * supported+annotation allowlist. Fails closed with `SchemaError` if an
 * unsupported keyword ($ref, format, if/then, allOf, not, uniqueItems, ...)
 * is found anywhere in the schema tree, including nested `properties`,
 * `additionalProperties`, `items`, `oneOf`, and `anyOf`.
 */
export function validateSchema(schema: unknown, path = "$"): void {
  if (!isPlainObject(schema)) {
    throw new SchemaError(
      `${path}: schema must be an object, got ${schema === null ? "null" : Array.isArray(schema) ? "array" : typeof schema}`
    );
  }

  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
      throw new SchemaError(`${path}: unsupported JSON Schema keyword '${key}'`);
    }

    if (key === "properties" && isPlainObject(value)) {
      for (const [propName, propSchema] of Object.entries(value)) {
        validateSchema(propSchema, `${path}.properties.${propName}`);
      }
    } else if (key === "additionalProperties" && isPlainObject(value)) {
      validateSchema(value, `${path}.additionalProperties`);
    } else if (key === "items") {
      if (isPlainObject(value)) {
        validateSchema(value, `${path}.items`);
      } else if (Array.isArray(value)) {
        value.forEach((itemSchema, idx) =>
          validateSchema(itemSchema, `${path}.items[${idx}]`)
        );
      }
    } else if ((key === "oneOf" || key === "anyOf") && Array.isArray(value)) {
      value.forEach((subSchema, idx) =>
        validateSchema(subSchema, `${path}.${key}[${idx}]`)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Secret-value ban — mirrors lib/omes/py/jobs/schema.py exactly. Enforced
// independently of whatever schema is in use: a schema bug must never be the
// only thing standing between a payload and a leaked secret.
// ---------------------------------------------------------------------------

const SECRET_NAME_RE = /(token|password|secret|credential|api[_-]?key|passphrase|cookie|authorization)/i;

/** Identifier shape allowed as an element of a list under a secret-like key (a NAME, never a value). */
const SECRET_NAME_ITEM_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Defense in depth beyond the key-name check: well-known secret-value
 * shapes (Stripe, GitHub, AWS, Slack, generic bearer tokens) are rejected
 * wherever they appear, even under a field name that does not look
 * secret-like. None of these literals are real credentials — they are the
 * well-documented public prefix formats those providers use.
 */
const SECRET_VALUE_SHAPE_RE =
  /(sk_live_|sk_test_|gh[pousr]_[A-Za-z0-9]|AKIA[0-9A-Z]{12,}|xox[baprs]-|Bearer [A-Za-z0-9._-]{10,})/;

function isSecretLikeScalar(key: string, value: JsonValue): boolean {
  if (!SECRET_NAME_RE.test(key)) return false;
  if (value === null) return false;
  if (isPlainObject(value)) {
    // Only a well-formed secret_ref indirection is allowed behind a secret-like field name.
    const keys = Object.keys(value);
    const isSecretRef =
      keys.every((k) => k === "store" || k === "key") &&
      "store" in value &&
      "key" in value;
    return !isSecretRef;
  }
  if (Array.isArray(value)) {
    // A list of secret NAMES (references resolved by the runtime) is a
    // reference, not a value: every element must be a short identifier.
    return !value.every(
      (v) => typeof v === "string" && SECRET_NAME_ITEM_RE.test(v)
    );
  }
  // Any other JSON type (string, number, bool) directly under a
  // secret-like field name is a raw value, which is always rejected.
  return true;
}

/**
 * Recursively finds (a) fields whose NAME matches a secret-like pattern but
 * whose value is not a `secret_ref` object ({store, key}) or null, and (b)
 * ANY string value, regardless of field name, that matches a well-known
 * secret-value shape. Returns human-readable error strings (empty = clean).
 * Runs independently of, and in addition to, schema validation.
 */
export function scanForRawSecrets(instance: JsonValue, path = "$"): string[] {
  const errors: string[] = [];

  if (typeof instance === "string" && SECRET_VALUE_SHAPE_RE.test(instance)) {
    errors.push(
      `${path}: value matches a known secret-value shape (e.g. sk_live_/ghp_/AKIA.../xoxb-/Bearer ...)`
    );
  }

  if (isPlainObject(instance)) {
    for (const [key, value] of Object.entries(instance)) {
      const childPath = `${path}.${key}`;
      if (isSecretLikeScalar(key, value as JsonValue)) {
        errors.push(
          `${childPath}: field name matches a secret pattern but does not hold a secret_ref object ({'store','key'}) or null`
        );
      }
      errors.push(...scanForRawSecrets(value as JsonValue, childPath));
    }
  } else if (Array.isArray(instance)) {
    instance.forEach((item, i) => {
      errors.push(...scanForRawSecrets(item, `${path}[${i}]`));
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Mimics Python's `repr()` for JSON-ish values, so error messages that
 * quote a schema keyword's value (`expected type 'integer'`, `expected
 * const 'hmac-sha256'`) match `lib/omes/py/jobs/schema.py`'s `!r`-formatted
 * output byte-for-byte where the OMES contract fixtures' `.reason.txt`
 * files assert on that exact substring.
 */
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`
    );
    return `{${entries.join(", ")}}`;
  }
  return String(value);
}

function typeMatches(
  instance: JsonValue,
  typeName: string,
  path: string,
  floatLiteralPaths: ReadonlySet<string>
): boolean {
  switch (typeName) {
    case "object":
      return isPlainObject(instance);
    case "array":
      return Array.isArray(instance);
    case "string":
      return typeof instance === "string";
    case "integer":
      // A number literal written with a decimal point or exponent (e.g.
      // `19.0`) is a JSON *float*, exactly as `lib/omes/py/jobs/schema.py`
      // treats it (Python's `json.load` gives a `float`, which fails
      // `isinstance(instance, int)`) — even though `Number.isInteger(19.0)`
      // is mathematically `true` in JS. `floatLiteralPaths` (populated only
      // when the caller parsed via `parseJsonTrackingFloats`, i.e. had the
      // raw JSON text) is what lets this check see that distinction; without
      // raw text, JS has already lost it and this falls back to
      // `Number.isInteger` alone.
      return (
        typeof instance === "number" &&
        Number.isInteger(instance) &&
        !floatLiteralPaths.has(path)
      );
    case "number":
      return typeof instance === "number";
    case "boolean":
      return typeof instance === "boolean";
    case "null":
      return instance === null;
    default:
      throw new SchemaError(`unsupported type keyword: '${typeName}'`);
  }
}

function validateInner(
  instance: JsonValue,
  schema: JsonSchema,
  path: string,
  errors: string[],
  floatLiteralPaths: ReadonlySet<string>
): void {
  if (!isPlainObject(schema)) {
    throw new SchemaError(`schema at ${path} is not an object`);
  }

  if ("const" in schema) {
    if (JSON.stringify(instance) !== JSON.stringify(schema.const)) {
      errors.push(
        `${path}: expected const ${pyRepr(schema.const)}, got ${pyRepr(instance)}`
      );
      return;
    }
  }

  if ("enum" in schema && schema.enum) {
    const matches = schema.enum.some(
      (v) => JSON.stringify(v) === JSON.stringify(instance)
    );
    if (!matches) {
      errors.push(
        `${path}: ${pyRepr(instance)} is not one of ${pyRepr(schema.enum)}`
      );
      return;
    }
  }

  const typeSpec = schema.type;
  if (typeSpec !== undefined) {
    const typeNames = Array.isArray(typeSpec) ? typeSpec : [typeSpec];
    if (!typeNames.some((t) => typeMatches(instance, t, path, floatLiteralPaths))) {
      errors.push(
        `${path}: expected type ${pyRepr(typeSpec)}, got ${instance === null ? "null" : Array.isArray(instance) ? "array" : typeof instance}`
      );
      return;
    }
  }

  if (typeof instance === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(instance)) {
      errors.push(
        `${path}: ${pyRepr(instance)} does not match pattern ${pyRepr(schema.pattern)}`
      );
    }
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(
        `${path}: ${JSON.stringify(instance)} length ${instance.length} is shorter than minLength ${schema.minLength}`
      );
    }
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) {
      errors.push(
        `${path}: ${JSON.stringify(instance)} length ${instance.length} is longer than maxLength ${schema.maxLength}`
      );
    }
  }

  if (typeof instance === "number") {
    if (schema.minimum !== undefined && instance < schema.minimum) {
      errors.push(`${path}: ${instance} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && instance > schema.maximum) {
      errors.push(`${path}: ${instance} is greater than maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(
        `${path}: has ${instance.length} items, fewer than minItems ${schema.minItems}`
      );
    }
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
      errors.push(
        `${path}: has ${instance.length} items, more than maxItems ${schema.maxItems}`
      );
    }
    const itemSchema = schema.items;
    if (itemSchema !== undefined && !Array.isArray(itemSchema)) {
      instance.forEach((item, i) =>
        validateInner(item, itemSchema, `${path}[${i}]`, errors, floatLiteralPaths)
      );
    }
  }

  if (isPlainObject(instance)) {
    for (const name of schema.required ?? []) {
      if (!(name in instance)) {
        errors.push(`${path}: missing required property '${name}'`);
      }
    }

    const properties = schema.properties ?? {};
    for (const [name, value] of Object.entries(instance)) {
      const propSchema = properties[name];
      if (propSchema !== undefined) {
        validateInner(
          value as JsonValue,
          propSchema,
          `${path}.${name}`,
          errors,
          floatLiteralPaths
        );
      }
    }

    const additional = schema.additionalProperties;
    if (additional === false) {
      const extra = Object.keys(instance)
        .filter((k) => !(k in properties))
        .sort();
      if (extra.length > 0) {
        errors.push(`${path}: additional properties not allowed: [${extra.join(", ")}]`);
      }
    } else if (isPlainObject(additional)) {
      for (const name of Object.keys(instance).filter((k) => !(k in properties))) {
        validateInner(
          instance[name] as JsonValue,
          additional as JsonSchema,
          `${path}.${name}`,
          errors,
          floatLiteralPaths
        );
      }
    }
  }

  for (const combinator of ["oneOf", "anyOf"] as const) {
    const subSchemas = schema[combinator];
    if (subSchemas) {
      let matches = 0;
      for (const sub of subSchemas) {
        const subErrors: string[] = [];
        validateInner(instance, sub, path, subErrors, floatLiteralPaths);
        if (subErrors.length === 0) matches++;
      }
      if (combinator === "oneOf" && matches !== 1) {
        errors.push(
          `${path}: matched ${matches} of ${subSchemas.length} oneOf branches, expected exactly 1`
        );
      }
      if (combinator === "anyOf" && matches < 1) {
        errors.push(
          `${path}: matched 0 of ${subSchemas.length} anyOf branches, expected at least 1`
        );
      }
    }
  }
}

/**
 * Validates `instance` against `schema`. Returns a list of error strings
 * (empty = valid). Fails closed by throwing `SchemaError` if `schema`
 * contains unsupported keywords. Always also runs the independent raw-secret
 * scan, regardless of what the schema itself declares.
 */
const EMPTY_FLOAT_LITERAL_PATHS: ReadonlySet<string> = new Set();

export function validate(
  instance: JsonValue,
  schema: JsonSchema,
  path = "$",
  floatLiteralPaths: ReadonlySet<string> = EMPTY_FLOAT_LITERAL_PATHS
): string[] {
  validateSchema(schema, path);
  const errors: string[] = [];
  validateInner(instance, schema, path, errors, floatLiteralPaths);
  errors.push(...scanForRawSecrets(instance, path));
  return errors;
}

/**
 * Same as `validate()`, but throws `ContractValidationError` if any errors
 * are found instead of returning them — the "fail closed, no silent
 * partial-success" entry point callers outside this module should prefer.
 */
export function assertValid(
  instance: JsonValue,
  schema: JsonSchema,
  path = "$",
  floatLiteralPaths: ReadonlySet<string> = EMPTY_FLOAT_LITERAL_PATHS
): void {
  const errors = validate(instance, schema, path, floatLiteralPaths);
  if (errors.length > 0) {
    throw new ContractValidationError(errors);
  }
}
