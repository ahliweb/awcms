/**
 * What a failed delivery is allowed to PERSIST (`last_error_message`,
 * `dead_letter_reason`), which operators read through the admin console.
 *
 * `sanitizeErrorForLog` redacts secrets, not filesystem paths. A consumer's
 * `handle` is reached through a lazy `import()` (ADR-0134), so a bad deploy
 * surfaces as `Cannot find module '/app/dist/server/...'` and would write the
 * server's absolute layout into a tenant-readable row. For module-resolution
 * failures only, absolute paths are replaced; every other message is untouched
 * (a blanket path scrub would mangle ordinary text such as a URL path).
 */
const MODULE_RESOLUTION_FAILURE =
  /Cannot find (?:module|package)|Module not found|Failed to resolve import|ERR_MODULE_NOT_FOUND/i;

const ABSOLUTE_PATH =
  /(?:[A-Za-z]:\\|file:\/\/\/?|\/)[^\s'"`<>)]*[\\/][^\s'"`<>)]*/g;

export function toPersistableErrorMessage(message: string): string {
  if (!MODULE_RESOLUTION_FAILURE.test(message)) {
    return message;
  }

  return message.replace(ABSOLUTE_PATH, "<path>");
}
