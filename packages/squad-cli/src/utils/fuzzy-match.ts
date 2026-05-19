/**
 * Fuzzy-match utilities for command and callsign suggestions.
 *
 * Pure functions — no I/O, no filesystem, no env, no logging.
 * Unicode-safe: code points are counted via Array.from() before the DP loops.
 *
 * @module utils/fuzzy-match
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses a two-row dynamic programming approach for O(min(|a|,|b|)) memory.
 * Iterates over Unicode code points so accented characters and emoji are
 * handled correctly.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aPoints = Array.from(a);
  const bPoints = Array.from(b);

  const aLen = aPoints.length;
  const bLen = bPoints.length;

  // Initialise the "previous" row as [0, 1, 2, …, bLen].
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);

  for (let i = 1; i <= aLen; i++) {
    const curr = new Array<number>(bLen + 1);
    curr[0] = i;

    for (let j = 1; j <= bLen; j++) {
      const cost = aPoints[i - 1] === bPoints[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,   // insertion
        prev[j - 1]! + cost, // substitution
      );
    }

    prev = curr;
  }

  return prev[bLen]!;
}

/**
 * Return the best-matching candidate for `needle`, or `null` when no
 * candidate is within `maxDistance` edits.
 *
 * - Case-sensitive.
 * - Tie-breaking is stable: the first candidate in input order wins.
 * - Does not special-case exact matches; the DP returns 0 naturally.
 *
 * @param needle      - The string typed by the user.
 * @param candidates  - The set of known valid strings to compare against.
 * @param maxDistance - Maximum edit distance to accept (default: 2).
 */
export function suggestSimilar(
  needle: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | null {
  if (candidates.length === 0) return null;

  let bestCandidate: string | null = null;
  let bestDistance = maxDistance + 1; // sentinel — anything ≤ maxDistance beats it

  for (const candidate of candidates) {
    const d = levenshteinDistance(needle, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      bestCandidate = candidate;
    }
  }

  return bestDistance <= maxDistance ? bestCandidate : null;
}
