/**
 * The SQL half of the message row confinement (Issue #1265). Kept free of any
 * import so the enqueue path (reached by scheduled jobs) can use it without
 * pulling the access loader — and with it the `channel_accounts` module — into
 * their import closure. The decision half is `whatsapp-message-scope.ts`.
 *
 * `null` is every row; a list is the `type:id` scopes whose rows are visible
 * (an empty list means no row). A NULL scope concatenates to NULL and never
 * matches, so an unscoped row is hidden from a confined caller.
 */
export type MessageScopeKeys = string[] | null;

export function messageScopeFilter(tx: Bun.SQL, scopeKeys: MessageScopeKeys) {
  return {
    unconfined: scopeKeys === null,
    keys: tx.array(scopeKeys ?? [], "text")
  };
}
