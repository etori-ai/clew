import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuIcon, SystemMark, Thread } from '@clew/contracts';
import { areasQuery } from './queries';

/** What a mark draws (D71): the area's word and icon, the system's word, and the ordinal that gives the chip its hue. */
export interface Mark {
  /** The area's title, the word on the chip and first in a row's meta line. */
  title: string;
  icon?: MenuIcon;
  /** The system's word: "Personalsystemet". */
  source: string;
  connector: string;
  /** Null for Clew's own systems: the outlined house mark. */
  ordinal: number | null;
}
const EMPTY_AREAS: Area[] = [];
const EMPTY_SYSTEMS: SystemMark[] = [];

/**
 * The one lookup from a card, an area or a ref to its mark (D71), over what `/api/areas` gives the person: the areas
 * with their icons and the systems with their ordinals. A page asks here and draws `AreaChip` or `AreaGlyph` from
 * `@clew/ui`; nothing here knows a hue.
 */
export function useMarks() {
  const data = useQuery(areasQuery).data;
  const areas = data?.areas ?? EMPTY_AREAS;
  const systems = data?.systems ?? EMPTY_SYSTEMS;
  return useMemo(() => {
    const system = (connector: string) => systems.find(s => s.connector === connector);
    const area = (id: string) => areas.find(a => a.id === id);
    /** The area's word for a card, as the page has always said it ("Fråga" for the person's own questions). */
    const areaTitle = (id: string) => area(id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
    const ofArea = (id: string, connector?: string): Mark => {
      const a = area(id);
      const from = a?.connector ?? connector ?? '';
      const s = system(from);
      return {
        title: areaTitle(id),
        ...(a?.icon ? { icon: a.icon } : {}),
        source: s?.source ?? a?.source ?? '',
        connector: from,
        ordinal: s?.ordinal ?? null,
      };
    };
    /** A card's mark: its area, its system. The card's trigger names the source when the person cannot see the area. */
    const ofThread = (thread: Thread): Mark => {
      const mark = ofArea(thread.area, thread.connector);
      return mark.source ? mark : { ...mark, source: thread.trigger.source };
    };
    /**
     * The system a card's row comes from (D55: a job's steps are each one system's), read from the ref's first segment
     * when it names a system the person can see. The area is that system's when it has exactly one, so the icon and the
     * word are never a guess; otherwise undefined, and the row draws no glyph rather than a wrong one.
     */
    const ofRef = (ref: string): (Mark & { area: boolean }) | undefined => {
      const s = system(ref.split(':')[0] ?? '');
      if (!s) return undefined;
      const own = areas.filter(a => a.connector === s.connector);
      const only = own.length === 1 ? own[0] : undefined;
      return {
        title: only?.title ?? '',
        ...(only?.icon ? { icon: only.icon } : {}),
        source: s.source,
        connector: s.connector,
        ordinal: s.ordinal,
        area: !!only,
      };
    };
    return { system, area, areaTitle, ofArea, ofThread, ofRef, systems };
  }, [areas, systems]);
}
export type Marks = ReturnType<typeof useMarks>;
