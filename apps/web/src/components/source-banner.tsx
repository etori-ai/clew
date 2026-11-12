import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, VStack, useAnnounce } from '@clew/ui';
import { areasQuery, threadsQuery } from '../queries';
import { keys } from '../query-keys';
import { useMarks } from '../marks';

const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
/** "Budget", "Budget och Fakturor", "Budget, Fakturor och Lön". */
const joined = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} och ${words.at(-1)}`;

/**
 * A connected system that does not answer (D8, D71 artboard 8): an Astryx `Banner` in warning at the top of every page,
 * one per system, read from the source statuses `/api/threads` already carries. Words only, no chip: a banner is text.
 * It says since when the system has been silent (its last answer), which cards may be old, and that what the person
 * sends waits in the queue and is read back (D45, D47). "Försök igen" asks for the cards again. The first time a
 * system is seen silent the banner's words are spoken once (4.1.3), since the statuses arrive after the page.
 */
export function useSourceBanner() {
  const client = useQueryClient();
  const sources = useQuery(threadsQuery).data?.sources;
  const areasAnswer = useQuery(areasQuery);
  const areas = areasAnswer.data?.areas;
  const marks = useMarks();
  const announce = useAnnounce();
  const down = (sources ?? [])
    .filter(s => s.error)
    .map(s => {
      const source = marks.system(s.connector)?.source ?? s.connector;
      const under = (areas ?? []).filter(a => a.connector === s.connector).map(a => a.title);
      return {
        connector: s.connector,
        title: `${source} svarar inte${s.lastSuccess ? ` sedan ${clock.format(new Date(s.lastSuccess))}` : ''}`,
        line: `${under.length ? `Ärendena under ${joined(under)}` : `Ärendena från ${source}`} kan vara gamla. Det du skickar köas och läses tillbaka när systemet svarar.`,
      };
    });
  const said = useRef(new Set<string>());
  const silent = down.map(d => d.connector).join(' ');
  // The words name the system and its areas, which `/api/areas` gives. The banner waits for that answer (or its
  // failure) before it is drawn or spoken: before it, the page would show the connector's id ("finance") in the name's
  // place, and the words are spoken once, so a person would hear the id and never the name.
  const named = !areasAnswer.isPending;
  useEffect(() => {
    if (sources === undefined || !named) return;
    const fresh = down.filter(d => !said.current.has(d.connector));
    for (const d of fresh) said.current.add(d.connector);
    for (const c of [...said.current]) if (!down.some(d => d.connector === c)) said.current.delete(c);
    if (fresh.length) announce(fresh.map(d => `${d.title}. ${d.line}`).join(' '));
  }, [silent, named]);
  if (!down.length || !named) return null;
  return (
    <VStack gap={0}>
      {down.map(d => (
        <Banner
          key={d.connector}
          status="warning"
          container="section"
          collapsible={false}
          title={d.title}
          description={d.line}
          endContent={
            <Button
              size="sm"
              variant="ghost"
              label="Försök igen"
              clickAction={() => client.invalidateQueries({ queryKey: keys.threads })}
            />
          }
        />
      ))}
    </VStack>
  );
}
