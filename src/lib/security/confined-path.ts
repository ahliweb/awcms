/**
 * Confining an externally-supplied path to a configured root — finding A7 of
 * the 17 August 2026 audit round.
 *
 * `sync-storage` accepts `localPath` from an HMAC-authenticated node and the
 * cron dispatcher runs `Bun.file(localPath)` on the SERVER. With no
 * confinement that is an arbitrary-path read, and the distinguishing error text
 * travels back to the node through `last_error` on
 * `GET /api/v1/sync/objects/status` — an existence oracle for any path on the
 * host, answerable one string at a time.
 *
 * ## Why the check is textual BEFORE it is a resolve
 *
 * The usual shape — resolve, then `startsWith(root)` — is correct and is done
 * here, but it is the second line of defence, not the first. Resolution
 * collapses `..`, so a candidate that escaped and came back
 * (`a/../../../etc/passwd/../../var/x`) resolves inside the root and passes,
 * having named directories outside it along the way. Nothing reads those
 * directories, so it is not itself an exploit — but a rule that ACCEPTS such a
 * string is one refactor away from a rule that follows it. Refusing `..` as a
 * segment before resolving makes the accepted set describable in one sentence:
 * a relative path of ordinary segments, under the root.
 *
 * ## What it deliberately does not do
 *
 * It does not resolve symlinks. `realpath` would require the file to exist, and
 * the honest answer for a missing file is "not found", not "cannot check". A
 * symlink pointing out of the root is a compromise of the server's own
 * filesystem, which is a strictly larger event than the one this guards
 * against, and treating it here would give a false impression that this
 * function is a sandbox. It is a confinement check for a supplied STRING.
 *
 * Deny-only. It can refuse a path or hand back the resolved one; it never
 * widens what a caller may reach.
 */
import { isAbsolute, resolve, sep } from "node:path";

export type ConfinedPathRefusal =
  /** Empty, whitespace-only, or not a string at all. */
  | "empty"
  /** Contains a NUL or other C0 control character — a truncation trick in any C-backed syscall. */
  | "control_character"
  /** Absolute (`/x`, `\\x`, `C:\x`) — the caller names a root, so the candidate must be relative to it. */
  | "absolute"
  /** Contains a `..` segment. Refused before resolution; see the header. */
  | "traversal"
  /** Resolved outside the root. The backstop for anything the textual rules did not name. */
  | "outside_root";

export type ConfinedPathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; refusal: ConfinedPathRefusal };

/** C0 plus DEL. NUL is the dangerous one; the rest have no business in a path here. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Resolves `candidate` under `root`, refusing anything that could name a file
 * outside it.
 *
 * `root` is trusted configuration and is resolved against the process CWD, so a
 * relative default like `./var/object-sync` works the same way
 * `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`'s does.
 */
export function resolveConfinedPath(
  root: string,
  candidate: unknown
): ConfinedPathResult {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return { ok: false, refusal: "empty" };
  }

  const value = candidate.trim();

  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, refusal: "control_character" };
  }

  // Backslash is checked explicitly rather than left to `isAbsolute`, which is
  // platform-dependent: on POSIX `C:\x` and `\\server\share` are both ordinary
  // relative filenames. The rule must not change with the host OS, because the
  // node supplying the string does not know what the server runs on.
  if (isAbsolute(value) || value.startsWith("/") || value.includes("\\")) {
    return { ok: false, refusal: "absolute" };
  }

  if (value.split(/[/]/).some((segment) => segment === "..")) {
    return { ok: false, refusal: "traversal" };
  }

  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, value);

  // `=== root` is not an accepted answer: the root directory itself is not a
  // file to upload, and accepting it would make an empty-ish candidate resolve
  // to something readable.
  if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    return { ok: false, refusal: "outside_root" };
  }

  return { ok: true, absolutePath };
}

/**
 * The refusal, worded for a caller that is not the operator.
 *
 * Every refusal maps to the SAME sentence on purpose. Telling a node which rule
 * it broke is telling it what the rules are, which is most of what an oracle
 * needs; the specific `refusal` goes to the server log, where the operator
 * debugging a genuinely misconfigured node can see it.
 */
export function confinedPathRefusalMessage(): string {
  return "localPath must be a relative path inside the configured object-sync root.";
}
