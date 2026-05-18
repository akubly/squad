/**
 * Shared fuzzy-match helper for callsign suggestion.
 *
 * Returns the closest candidate to a query string using prefix matching
 * first, then Levenshtein edit distance as a tiebreaker.
 *
 * @module lib/close-match
 */

/**
 * Find the closest match to `query` within `candidates`.
 *
 * Returns `null` when the candidates list is empty or no candidate is
 * within the edit-distance threshold.
 */
export function findCloseMatch(query: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const lower = query.toLowerCase();
  const prefix = candidates.find(
    c => c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase()),
  );
  if (prefix) return prefix;
  function editDist(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = a[i - 1] === b[j - 1] ? row[j - 1]! : 1 + Math.min(prev, row[j]!, row[j - 1]!);
        row[j - 1] = prev;
        prev = cur;
      }
      row[b.length] = prev;
    }
    return row[b.length]!;
  }
  let best: { name: string; d: number } | null = null;
  for (const c of candidates) {
    const d = editDist(query, c);
    if (!best || d < best.d) best = { name: c, d };
  }
  const threshold = Math.max(3, Math.floor(query.length / 2));
  return best && best.d <= threshold ? best.name : null;
}
