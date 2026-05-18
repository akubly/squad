/**
 * CLI argument parsing helpers for the squad assign command.
 *
 * Handles both `--flag value` and `--flag=value` forms for all named options,
 * per standard POSIX/GNU convention.
 *
 * @module commands/assign-args
 */

export interface AssignCliArgs {
  callsignOrUrl: string | undefined;
  cloneTo: string | undefined;
  callsign: string | undefined;
  registryPath: string | undefined;
  targetDir: string | undefined;
}

const NAMED_FLAGS = ['--clone-to', '--callsign', '--registry-path', '--target-dir'] as const;

/**
 * Extract a named argument value from an args array, handling both
 * `--flag value` and `--flag=value` forms.
 */
export function argValue(args: string[], flag: string): string | undefined {
  const eqEntry = args.find(a => a.startsWith(`${flag}=`));
  if (eqEntry) return eqEntry.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

/**
 * Parse CLI arguments for the `squad assign` subcommand.
 *
 * The first non-flag token that is not the value of a known named flag is
 * treated as the positional callsign-or-URL argument. Named flags are parsed
 * in both `--flag value` and `--flag=value` forms.
 */
export function parseAssignArgs(args: string[]): AssignCliArgs {
  // Collect indices that are flag values in --flag value form so we don't
  // accidentally treat them as the positional argument.
  const flagValueIndices = new Set<number>();
  for (const flag of NAMED_FLAGS) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      flagValueIndices.add(idx + 1);
    }
  }

  return {
    callsignOrUrl: args.find((a, i) => !a.startsWith('-') && !flagValueIndices.has(i)),
    cloneTo: argValue(args, '--clone-to'),
    callsign: argValue(args, '--callsign'),
    registryPath: argValue(args, '--registry-path'),
    targetDir: argValue(args, '--target-dir'),
  };
}
