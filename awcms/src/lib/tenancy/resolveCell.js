/**
 * resolveCell.js
 * Deployment Cell — Runtime Resolution Layer
 *
 * Utility helpers for evaluating whether a deployment cell record
 * allows active routing. Used by resolveTenant.js and admin UIs.
 *
 * Spec reference: §10.2 Resolution algorithm (step 4)
 */

/**
 * Cell statuses that allow live routing.
 */
const ACTIVE_CELL_STATUSES = ['active'];

/**
 * Cell statuses that trigger a maintenance response.
 */
const MAINTENANCE_CELL_STATUSES = ['maintenance', 'provisioning'];

/**
 * Returns true if the cell is eligible to serve live traffic.
 *
 * @param {{ status: string } | null | undefined} cell
 * @returns {boolean}
 */
export function isCellActive(cell) {
  if (!cell || typeof cell.status !== 'string') return false;
  return ACTIVE_CELL_STATUSES.includes(cell.status);
}

/**
 * Returns true if the cell is in maintenance mode and should serve
 * a maintenance page rather than a 404.
 *
 * @param {{ status: string } | null | undefined} cell
 * @returns {boolean}
 */
export function isCellInMaintenance(cell) {
  if (!cell || typeof cell.status !== 'string') return false;
  return MAINTENANCE_CELL_STATUSES.includes(cell.status);
}

/**
 * Returns a human-readable failure reason for a cell that is not active.
 *
 * @param {{ status: string } | null | undefined} cell
 * @returns {string}
 */
export function getCellFailureReason(cell) {
  if (!cell) return 'Cell not found';
  if (cell.status === 'decommissioned') return 'Cell has been decommissioned';
  if (cell.status === 'draft') return 'Cell is not yet provisioned';
  if (MAINTENANCE_CELL_STATUSES.includes(cell.status)) return 'Cell is under maintenance';
  return `Cell status "${cell.status}" does not allow routing`;
}
