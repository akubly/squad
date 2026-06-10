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
