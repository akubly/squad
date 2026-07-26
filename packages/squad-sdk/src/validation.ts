/**
 * Shared validation constants for the squad SDK.
 *
 * @module validation
 */

/**
 * Matches a valid inbox handle: lowercase letter start, lowercase letters /
 * digits / hyphens only, 2–39 characters total.
 */
export const INBOX_HANDLE_RE = /^[a-z][a-z0-9-]{1,38}$/;

/**
 * Matches a valid squad callsign: lowercase letter start, lowercase letters /
 * digits / hyphens only, 2–39 characters total. Same character constraints as
 * INBOX_HANDLE_RE since the callsign appears in git branch names.
 */
export const CALLSIGN_RE = /^[a-z][a-z0-9-]{1,38}$/;
