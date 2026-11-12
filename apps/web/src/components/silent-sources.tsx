import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Button, HStack, Text, useAnnounce } from '@clew/ui';
import { areasQuery, threadsQuery } from '../queries';
import { useMarks } from '../marks';

/**
 * A connected system that does not answer (D8), said where its content is missing and nowhere else (D116, amended
 * 2026-11-12): no banner at the top of the page. A work item from it says on its row and in its head that it may be old
 * (`StaleMark`, `staleWhy`), a block or a page whose own read failed says so in itself with "Försök igen"
 * (`SilentNotice`), and the action dialog's last step says that what the person sends is queued and read back (D45,
 * D47). The statuses come with the cards (`/api/threads`, `sources`); the calendar's day and week also say it when their
 * own read fails. The first time a system is seen silent in a session it is said once, politely (4.1.3), since nothing
 * on the page announces itself: "<system> svarar inte".
 */
export interface SilentSource {
  connector: string;
  /** The system's word, "Personalsystemet"; "En källa" when the person cannot see the system's name. */
  source: string;
  /** When it last answered, or null when it never has. */
  since: string | null;
}
const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
/** "Personalsystemet svarar inte sedan 14:32", or without the time when it has not answered since the session began. */
export const silentLine = ({ source, since }: Pick<SilentSource, 'source' | 'since'>) =>
  `${source} svarar inte${since ? ` sedan ${clock.format(new Date(since))}` : ''}`;
/** What the action dialog's last step and a decision's confirmation add while the item's system is silent (D45, D47). */
export const QUEUED_LINE = 'Det du skickar köas och läses tillbaka när systemet svarar.';
/** "Personalsystemet", "Personalsystemet och Ekonomisystemet", "A, B och C". */
const joined = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} och ${words.at(-1)}`;
const EMPTY: SilentSource[] = [];

/**
 * The systems the cards come from that do not answer now, named. The list waits for the names (`/api/areas`) or their
 * failure: before them a system would be said by its id ("finance"), and the announcement is made once.
 */
export function useSilentSources() {
  const threads = useQuery(threadsQuery).data;
  const areas = useQuery(areasQuery);
  const marks = useMarks();
  const named = !areas.isPending;
  const sources = threads?.sources;
  const list = useMemo(() => {
    if (!named || !sources) return EMPTY;
    const down = sources.filter(s => s.error);
    if (!down.length) return EMPTY;
    return down.map(s => ({
      connector: s.connector,
      source:
        marks.system(s.connector)?.source ??
        threads?.threads.find(t => t.connector === s.connector)?.trigger.source ??
        'En källa',
      since: s.lastSuccess,
    }));
  }, [named, sources, marks, threads?.threads]);
  const of = useCallback((connector: string) => list.find(s => s.connector === connector), [list]);
  return { list, of, named };
}

/** Who has been told in this session (one query client per signed-in session, D33): a system is said once. */
const told = new WeakMap<QueryClient, Set<string>>();
/** Says once per session that a system does not answer, politely (4.1.3): "Kalendern svarar inte". */
export function useSaySilent() {
  const client = useQueryClient();
  const announce = useAnnounce();
  return useCallback(
    (systems: readonly Pick<SilentSource, 'connector' | 'source'>[]) => {
      let said = told.get(client);
      if (!said) told.set(client, (said = new Set()));
      const fresh = systems.filter(s => !said!.has(s.connector));
      for (const s of fresh) said.add(s.connector);
      if (fresh.length) announce(`${joined(fresh.map(s => s.source))} svarar inte`);
    },
    [client, announce],
  );
}

/** Mounted by the shell on every page: the first time a system the cards come from is seen silent, it is said once. */
export function useAnnounceSilentSources() {
  const { list } = useSilentSources();
  const say = useSaySilent();
  const silent = list.map(s => s.connector).join(' ');
  useEffect(() => {
    if (list.length) say(list);
  }, [silent, say]);
}

/** A work item from a silent system: its row's why line ends with the quiet fact, as a reminder's wait does. */
export const staleWhy = (why: string) => `${why} · kan vara gammal`;
/** A work item from a silent system, in its head: that it may be old and since when its system has been silent. */
export function StaleMark({ silent }: { silent: SilentSource }) {
  return <Text type="supporting">{`Kan vara gammal · ${silentLine(silent)}`}</Text>;
}

/**
 * A block or a page whose own read failed because its system does not answer: the one sentence where its content would
 * be, with "Försök igen" (the in-section pattern of a person's sections and Personal).
 */
export function SilentNotice({
  silent,
  retrying,
  onRetry,
}: {
  silent: Pick<SilentSource, 'source' | 'since'>;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
      <Text as="p">{silentLine(silent)}</Text>
      <Button size="sm" variant="secondary" label="Försök igen" isLoading={retrying} onClick={onRetry} />
    </HStack>
  );
}
