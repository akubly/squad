/**
 * Shared types for the unified doctor diagnostic system.
 *
 * Both the legacy system doctor and the registry-aware doctor
 * emit `DoctorFinding[]` through the unified runner, replacing
 * the prior dual-shape system (`DoctorCheck` / `RunDoctorResult`).
 *
 * @module cli/commands/doctor-types
 */

/** Severity levels for unified doctor findings. */
export type DoctorSeverity = 'info' | 'warn' | 'error';

/** Source subsystem that produced the finding. */
export type DoctorSource = 'system' | 'registry';

/** Optional repair action hint for a finding. Population deferred to a future piece. */
export interface DoctorRepair {
  command: string;
  description: string;
}

/** A single diagnostic finding from the unified doctor. */
export interface DoctorFinding {
  readonly severity: DoctorSeverity;
  /** Short identifier for the check that produced this finding (kebab or title). */
  readonly label: string;
  /** Human-readable description of the finding. */
  readonly message: string;
  /** Subsystem that produced the finding. */
  readonly source: DoctorSource;
  /** Optional repair hint — deferred to future piece. */
  readonly repair?: DoctorRepair;
}
