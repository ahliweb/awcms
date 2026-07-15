export type SoftDeleteColumns = {
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
};

export type ListOptions = {
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

export const SOFT_DELETE_COLUMNS = [
  "deleted_at",
  "deleted_by",
  "delete_reason"
] as const;

export function shouldIncludeDeleted(options: ListOptions = {}): boolean {
  return options.includeDeleted === true || options.onlyDeleted === true;
}

export function shouldOnlyListDeleted(options: ListOptions = {}): boolean {
  return options.onlyDeleted === true;
}

export function activeRecordPredicate(column = "deleted_at"): string {
  return `${column} IS NULL`;
}

export function deletedRecordPredicate(column = "deleted_at"): string {
  return `${column} IS NOT NULL`;
}
