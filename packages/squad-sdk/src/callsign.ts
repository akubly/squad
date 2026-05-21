import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';

export const CALLSIGN_MAX_LENGTH = 64;
export const CALLSIGN_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function formatCallsignValidationMessage(callsign: string): string {
  return `Callsign ${JSON.stringify(callsign)} is invalid. Callsigns must be lowercase alphanumeric with internal hyphens only (a-z, 0-9, -), 1-64 chars, no leading/trailing hyphen. Example: "my-squad", "gethelp-app".`;
}

export function isValidCallsign(callsign: string): boolean {
  return callsign.length > 0 && callsign.length <= CALLSIGN_MAX_LENGTH && CALLSIGN_PATTERN.test(callsign);
}

export function assertValidCallsign(callsign: string, source = 'callsign'): void {
  if (isValidCallsign(callsign)) {
    return;
  }

  throw new SquadError(
    formatCallsignValidationMessage(callsign),
    ErrorSeverity.ERROR,
    ErrorCategory.VALIDATION,
    { operation: 'callsign', timestamp: new Date(), metadata: { source } },
    false,
  );
}
