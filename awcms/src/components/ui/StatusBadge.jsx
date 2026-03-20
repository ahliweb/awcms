
import { cn } from '@/lib/utils';

/**
 * StatusBadge — unified semantic pill for status and priority values.
 *
 * Uses OKLCH CSS-variable tokens only — no hardcoded Tailwind color classes.
 * Supports content statuses, order statuses, priority levels, boolean states,
 * and custom labels.
 *
 * Usage:
 *   <StatusBadge status="published" />
 *   <StatusBadge status="urgent" />
 *   <StatusBadge status="paid" label="Paid" />
 *   <StatusBadge status="active" dot />
 */

const STATUS_CONFIG = {
  // --- Content lifecycle ---
  published: {
    className: 'bg-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_12%,transparent)] text-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_80%,var(--foreground))] border-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_25%,transparent)]',
    label: 'Published',
  },
  draft: {
    className: 'bg-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_12%,transparent)] text-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_75%,var(--foreground))] border-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_25%,transparent)]',
    label: 'Draft',
  },
  archived: {
    className: 'bg-muted/60 text-muted-foreground border-border/60',
    label: 'Archived',
  },
  expired: {
    className: 'bg-muted/60 text-muted-foreground border-border/60',
    label: 'Expired',
  },
  review: {
    className: 'bg-primary/10 text-primary border-primary/20',
    label: 'In Review',
  },

  // --- Product / inventory ---
  active: {
    className: 'bg-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_12%,transparent)] text-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_80%,var(--foreground))] border-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_25%,transparent)]',
    label: 'Active',
  },
  inactive: {
    className: 'bg-muted/60 text-muted-foreground border-border/60',
    label: 'Inactive',
  },
  out_of_stock: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'Out of Stock',
  },

  // --- Order lifecycle ---
  pending: {
    className: 'bg-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_12%,transparent)] text-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_75%,var(--foreground))] border-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_25%,transparent)]',
    label: 'Pending',
  },
  paid: {
    className: 'bg-primary/10 text-primary border-primary/20',
    label: 'Paid',
  },
  processing: {
    className: 'bg-secondary/60 text-secondary-foreground border-border/60',
    label: 'Processing',
  },
  shipped: {
    className: 'bg-accent/40 text-accent-foreground border-border/50',
    label: 'Shipped',
  },
  completed: {
    className: 'bg-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_12%,transparent)] text-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_80%,var(--foreground))] border-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_25%,transparent)]',
    label: 'Completed',
  },
  cancelled: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'Cancelled',
  },
  refunded: {
    className: 'bg-muted/60 text-muted-foreground border-border/60',
    label: 'Refunded',
  },

  // --- Payment ---
  unpaid: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'Unpaid',
  },
  partial: {
    className: 'bg-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_12%,transparent)] text-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_75%,var(--foreground))] border-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_25%,transparent)]',
    label: 'Partial',
  },

  // --- Priority ---
  urgent: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'Urgent',
  },
  high: {
    className: 'bg-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_15%,transparent)] text-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_75%,var(--foreground))] border-[color-mix(in_oklch,var(--color-warning,oklch(0.75_0.16_80))_30%,transparent)]',
    label: 'High',
  },
  normal: {
    className: 'bg-primary/10 text-primary border-primary/20',
    label: 'Normal',
  },
  low: {
    className: 'bg-muted/60 text-muted-foreground border-border/60',
    label: 'Low',
  },

  // --- Approval / workflow ---
  approved: {
    className: 'bg-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_12%,transparent)] text-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_80%,var(--foreground))] border-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_25%,transparent)]',
    label: 'Approved',
  },
  rejected: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'Rejected',
  },
  reviewed: {
    className: 'bg-primary/10 text-primary border-primary/20',
    label: 'Reviewed',
  },

  // --- Boolean / generic ---
  yes: {
    className: 'bg-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_12%,transparent)] text-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_80%,var(--foreground))] border-[color-mix(in_oklch,var(--color-success,oklch(0.65_0.18_145))_25%,transparent)]',
    label: 'Yes',
  },
  no: {
    className: 'bg-destructive/10 text-destructive border-destructive/20',
    label: 'No',
  },
};

const FALLBACK_CONFIG = {
  className: 'bg-muted/60 text-muted-foreground border-border/60',
};

/**
 * @param {object} props
 * @param {string} props.status - One of the known status keys, or any arbitrary string.
 * @param {string} [props.label] - Overrides the default display label for the status.
 * @param {boolean} [props.dot] - Shows a small colored dot before the label.
 * @param {string} [props.className] - Extra classes merged via cn().
 */
export function StatusBadge({ status, label, dot = false, className }) {
  const normalizedStatus = (status ?? '').toString().toLowerCase().replace(/\s+/g, '_');
  const config = STATUS_CONFIG[normalizedStatus] ?? FALLBACK_CONFIG;
  const displayLabel = label ?? config.label ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : '—');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current opacity-80 shrink-0"
          aria-hidden="true"
        />
      )}
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
