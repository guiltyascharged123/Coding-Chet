export type LabelRect = { id: string; left: number; top: number; width: number; height: number };
export function placeLabels(labels: LabelRect[], width: number, height: number): LabelRect[] {
  const placed: LabelRect[] = [];
  const clamp = (n: number, low: number, high: number) =>
    Math.max(low, Math.min(n, Math.max(low, high)));
  for (const label of [...labels].sort((a, b) => a.left - b.left || a.id.localeCompare(b.id))) {
    let best: LabelRect | undefined,
      score = Infinity;
    // Favor nearby positions above the character. Sideways room keeps a pair
    // meeting in the aisle readable without hiding either participant.
    for (let row = 0; row < 6; row++)
      for (let column = -6; column <= 6; column++) {
        const candidate = {
          ...label,
          left: clamp(label.left + column * 45, 8, width - label.width - 8),
          top: clamp(label.top - row * (label.height + 20), 52, height - label.height - 58),
        };
        const overlaps = placed.some(
          (p) =>
            candidate.left < p.left + p.width + 7 &&
            candidate.left + candidate.width + 7 > p.left &&
            candidate.top < p.top + p.height + 7 &&
            candidate.top + candidate.height + 7 > p.top,
        );
        const cost =
          (candidate.left - label.left) ** 2 +
          (candidate.top - label.top) ** 2 * 1.15 +
          (overlaps ? 1_000_000 : 0);
        if (cost < score) {
          best = candidate;
          score = cost;
        }
      }
    placed.push(best!);
  }
  return placed;
}
