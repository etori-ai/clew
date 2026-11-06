import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, MenuIcon, SystemMark, Thread } from '@clew/contracts';
import { areasQuery, threadsQuery } from './queries';

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
const EMPTY_MENU: MenuEntry[] = [];

/**
 * The one lookup from a card, an area or a ref to its mark (D71), over what `/api/areas` gives the person: the areas
 * with their icons and the systems with their ordinals. A page asks here and draws `AreaChip` or `AreaGlyph` from
 * `@clew/ui`; nothing here knows a hue.
 */
export function useMarks() {
  const data = useQuery(areasQuery).data;
  const areas = data?.areas ?? EMPTY_AREAS;
  const systems = data?.systems ?? EMPTY_SYSTEMS;
  const menu = data?.menu ?? EMPTY_MENU;
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
    /**
     * A declared view's mark (D71, artboards 4 and 7): the area that offers the capability, else the system's one area
     * (a contact card is Kontakter's), else its row in the menu ("Mötesrum" of a calendar with two areas), else the
     * system's word alone. The hue is always the system's.
     */
    const ofCapability = (capability: string, connector: string, source: string): Mark => {
      const offering = areas.find(a => a.connector === connector && a.standing.some(s => s.capability === capability));
      if (offering) return ofArea(offering.id, connector);
      const own = areas.filter(a => a.connector === connector);
      if (own.length === 1) return ofArea(own[0]!.id, connector);
      const s = system(connector);
      const entry = menu.find(e => e.capability === capability);
      return {
        title: entry?.label ?? s?.source ?? source,
        ...(entry?.icon ? { icon: entry.icon } : {}),
        source: s?.source ?? source,
        connector,
        ordinal: s?.ordinal ?? null,
      };
    };
    /**
     * The system a chip, a token or an `@` row belongs to (D71, artboard 8), from its ref: a capability's connector is
     * the name's first part, a document's the ref's second segment, a meeting and a proposal are the calendar's, a row's
     * the ref's first segment (D55). A card is the caller's to resolve: its ref names no system.
     */
    const ofObject = (ref: string) => {
      const [head = '', second = ''] = ref.split(':');
      if (head === 'thread') return undefined;
      const connector =
        head === 'capability'
          ? (second.split('.')[0] ?? '')
          : head === 'document'
            ? second
            : head === 'event' || head === 'proposal'
              ? 'calendar'
              : head;
      return ofRef(`${connector}:`);
    };
    return { system, area, areaTitle, ofArea, ofThread, ofRef, ofCapability, ofObject, systems };
  }, [areas, systems, menu]);
}
export type Marks = ReturnType<typeof useMarks>;

/**
 * The mark of a chip, a composer token or an `@` row (D71, artboard 8): a card's own mark; any other ref the system it
 * names, falling back to its card's when that system has several areas and the ref alone cannot say which.
 */
export function useObjectMark() {
  const marks = useMarks();
  const threads = useQuery(threadsQuery).data?.threads;
  return useCallback(
    (ref: string, threadId?: string): Mark | undefined => {
      const id = ref.startsWith('thread:') ? ref.slice('thread:'.length) : threadId;
      const thread = id ? threads?.find(t => t.id === id) : undefined;
      const own = ref.startsWith('thread:') ? undefined : marks.ofObject(ref);
      return own?.icon ? own : thread ? marks.ofThread(thread) : own;
    },
    [marks, threads],
  );
}
