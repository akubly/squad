/**
 * Shared validation constants for the squad SDK.
 *
 * @module validation
 */

/**
 * Matches a valid developer alias: lowercase letter start, lowercase letters /
 * digits / hyphens only, 2–39 characters total.
 */
export const DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{1,38}$/;
