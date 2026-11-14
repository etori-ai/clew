import type { Area, FigureTone } from '@clew/contracts';

/** How many figures Läget shows on Hem (D126, board Hem): one row of tiles; every figure is on the unit's page. */
export const LAGE_ON_HEM = 4;
/** What needs the manager first, then what to watch, then the calm ones (D54's tones). */
const RANK: Readonly<Record<FigureTone, number>> = { alert: 2, warn: 1, ok: 0, none: 0 };

/** A figure Hem has something to show for: a value, from a source that answered. An empty state or a silence is not one. */
export const hasValue = (area: Area): boolean => !!area.figure && !area.figure.unavailable && !!area.figure.value;

/**
 * Which figures Läget shows on Hem and in what order (the product owner, 2026-11-14: eight tiles in two rows of uneven
 * shapes were too many): only those with a value, worst status first ("Behöver dig", then "Bevaka", then the calm ones),
 * in the areas' own order within a status, at most `max`. `total` counts every figure the unit's page lists, the calm,
 * the empty and the silent ones too, so Hem can say how many there are in all.
 */
export function lageOnHem(areas: readonly Area[], max = LAGE_ON_HEM): { shown: Area[]; total: number } {
  const shown = areas
    .flatMap((area, index) => (hasValue(area) ? [{ area, index, rank: RANK[area.figure!.tone] }] : []))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, max)
    .map(x => x.area);
  return { shown, total: areas.filter(a => a.figure).length };
}
