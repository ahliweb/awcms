/**
 * Bounded-depth thread builder (ADR-0041, ported from awcms-micro Issue #271).
 * Pure domain — no I/O. Assembles a flat list of approved comments into a
 * bounded-depth reply tree and REJECTS unbounded recursion.
 *
 * A reply's depth is always `parent.depth + 1`, hard-capped at `HARD_MAX_DEPTH`
 * (the same value the DB CHECK on `awcms_comments_comments.depth` enforces in
 * `sql/066`). A tenant's `max_depth` setting may only TIGHTEN that, never exceed
 * it — the cap is a structural guarantee about how deep a public page can
 * render, not a preference.
 */
export const HARD_MAX_DEPTH = 4;

export type ThreadCommentInput = {
  id: string;
  parentId: string | null;
  depth: number;
  createdAt: Date;
};

export type ThreadNode<T extends ThreadCommentInput> = T & {
  replies: ThreadNode<T>[];
};

/**
 * Computes the depth a reply to `parentDepth` would have, throwing
 * `CommentDepthExceededError` if it would exceed the effective max (the smaller
 * of the tenant setting and the hard cap). A top-level comment passes
 * `parentDepth = null` and gets depth 0.
 */
export function resolveReplyDepth(
  parentDepth: number | null,
  tenantMaxDepth: number
): number {
  const effectiveMax = Math.min(
    Math.max(0, Math.trunc(tenantMaxDepth)),
    HARD_MAX_DEPTH
  );

  if (parentDepth === null) return 0;

  const depth = parentDepth + 1;
  if (depth > effectiveMax) {
    throw new CommentDepthExceededError(depth, effectiveMax);
  }
  return depth;
}

/**
 * Builds a bounded-depth tree from a flat list.
 *
 * A node whose parent is absent from the list — a reply to a comment that was
 * rejected or deleted after the reply was approved — is promoted to a root
 * rather than dropped, so an approved reply never silently vanishes from the
 * page.
 *
 * Cycles cannot occur, because `depth` is monotonic and validated on write, but
 * the `parent.depth < node.depth` test guards the tree-building step against a
 * self- or ancestor-reference anyway: attaching only to a strictly shallower
 * node makes an infinite structure unrepresentable regardless of what the rows
 * say.
 */
export function buildBoundedThread<T extends ThreadCommentInput>(
  comments: readonly T[]
): ThreadNode<T>[] {
  const byId = new Map<string, ThreadNode<T>>();
  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  const roots: ThreadNode<T>[] = [];
  for (const comment of comments) {
    const node = byId.get(comment.id)!;
    const parent = comment.parentId ? byId.get(comment.parentId) : undefined;

    if (parent && parent.id !== node.id && parent.depth < node.depth) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortByCreated = (a: ThreadNode<T>, b: ThreadNode<T>): number =>
    a.createdAt.getTime() - b.createdAt.getTime();

  const sortRecursively = (nodes: ThreadNode<T>[]): void => {
    nodes.sort(sortByCreated);
    for (const node of nodes) sortRecursively(node.replies);
  };

  sortRecursively(roots);
  return roots;
}

export class CommentDepthExceededError extends Error {
  constructor(
    public readonly attempted: number,
    public readonly max: number
  ) {
    super(
      `Comment reply depth ${attempted} exceeds the maximum allowed depth ${max}.`
    );
    this.name = "CommentDepthExceededError";
  }
}
