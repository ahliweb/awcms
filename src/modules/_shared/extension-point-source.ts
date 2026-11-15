import type { ModuleDescriptor } from "./module-contract";

/**
 * The injection seam of the descriptor-declared extension points (ADR-0164,
 * Issue #1277).
 *
 * The e-mail category registry and the WhatsApp template registry resolve what
 * modules declare (`emailTemplateCategories`, `whatsappTemplates`). They do NOT
 * import the module list themselves: a static `import { listModules }` in a
 * domain file puts every descriptor, and so `getWorkerDatabaseClient`, into the
 * import closure of every job that merely enqueues an e-mail, and the runner's
 * least-privilege withholding of `WORKER_DATABASE_URL` (audit L-5 of PR #1301,
 * derived from that closure) silently stops applying to it.
 *
 * Instead a COMPOSITION ROOT installs the source once: the web entry
 * (`src/middleware.ts`) and the dispatcher scripts that render or send derived
 * categories and templates. A process that asks for something only a descriptor
 * can answer, without a source installed, gets a clear error. It never gets
 * "unknown category, no variables": that was the silent per-process gap this
 * ADR removed.
 */
export type ExtensionPointSource = () => readonly ModuleDescriptor[];

export class ExtensionPointSourceNotInstalledError extends Error {
  constructor(what: string) {
    super(
      `${what} needs the module descriptors, but this process installed no extension-point source. Call installExtensionPointSource(listModules) from the process's composition root (src/middleware.ts or the dispatcher script); see ADR-0164.`
    );
    this.name = "ExtensionPointSourceNotInstalledError";
  }
}

let source: ExtensionPointSource | null = null;

export function installExtensionPointSource(next: ExtensionPointSource): void {
  source = next;
}

export function isExtensionPointSourceInstalled(): boolean {
  return source !== null;
}

/** The installed descriptors; throws, fail-closed, when no composition root installed a source. */
export function requireExtensionPointModules(
  what: string
): readonly ModuleDescriptor[] {
  if (source === null) {
    throw new ExtensionPointSourceNotInstalledError(what);
  }

  return source();
}

/** Test seam only. */
export function uninstallExtensionPointSourceForTests(): void {
  source = null;
}
