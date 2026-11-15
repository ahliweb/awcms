/**
 * Which `awcms_whatsapp_messages` ROWS a caller may see or act on (Issue #1265).
 *
 * A WhatsApp message carries its own business scope (`business_scope_type/id`,
 * brand) and may be unscoped. A caller confined to business scopes holds some
 * brands only, so the cancel route and the diagnostics read narrow rows by the
 * same rule the progress topic (Issue #1171 audit M-1) and the sender/consent
 * routes use: the scopes the caller holds through the access chokepoint
 * (descendants included); an UNSCOPED row is nobody's but an unconfined
 * caller's.
 *
 * `null` means "every row" (the caller is not confined). A list means "only rows
 * whose own `type:id` is in it", and an empty list means no row at all. A
 * channel module that cannot be loaded is a denial, never "unconfined".
 *
 * The SQL half lives in `whatsapp-message-scope-filter.ts` (import-free, so the
 * enqueue path does not pull this loader into scheduled jobs' import closure).
 */
import {
  loadSenderAccess,
  type SenderAccess,
  type SenderAccessContext,
  type SenderAccessGuard
} from "../infrastructure/channel-account-access-loader";
import type { MessageScopeKeys } from "./whatsapp-message-scope-filter";

export async function resolveMessageScopeKeys(
  context: SenderAccessContext,
  guard: SenderAccessGuard,
  /** Seam for the fail-closed test; production always uses the real loader. */
  load: () => Promise<SenderAccess | null> = loadSenderAccess
): Promise<MessageScopeKeys> {
  const access = await load();

  if (!access) return [];

  if (!(await access.isConfined(context))) return null;

  const covered = await access.coveredScopes(context, guard);

  return covered.map((scope) => `${scope.type}:${scope.id}`);
}
