import { useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  Text,
  VStack,
  useAnimatedLayout,
  useMediaQuery,
} from '@clew/ui';
import { entityListQuery, entityRowsQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { talkOf } from '../talk-address';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { TalkOverlay } from '../components/talk-overlay';
import { usePagePanel } from '../components/page-panel';
import { LIST_MIN, PERSON_PANEL, usePersonPanel } from '../components/person-panel';
import { useEntityAction } from '../entity-actions';
import { answerOf, peopleLine, silentOf, sourcesRead, valueCounts, type Answer } from './staff-model';
import { AllUnit, CompactUnit, LensUnit, SilentSources, ShowMenu, type Context, type Openers } from './staff-parts';

/** The list's column at its widest: the page width the person's page also has (1216 px) less the 32 px padding on each side. */
const COLUMN = 1216 - 2 * 32;
/** The lens in the address (D43, D83 rule 4): `?show=<capability>`; absent, or not a lens, is "Alla". */
const SHOW = 'show';

/**
 * Personal (D94, D97): the people the reader may ask about, one card per unit, as the canvas draws it (artboards A2,
 * B, A3). Personal knows no feature: what it shows of a person comes from the sources that say their rows are about a
 * person, placed by Clew. "Alla" has the columns an administrator chose, each the field of one source with the source
 * under its label, and "Just nu" with the fields of the chosen sources that need the reader. "Visa" picks a lens, a
 * source an administrator offers, and the list is then that source's view, sorted by need. Each row has its menu,
 * grouped by the system an action works in. A name leads to the person's page. "Just nu" with several cards opens
 * the person beside the list (`?person=<key>`, D83 rule 1), and the list is then drawn compact, its names choosing who
 * is beside it; whether a person is shown beside the list at all is open (2026-11-11). A card about a person opens in the
 * page's panel (`?card=<threadId>`, `page-panel.tsx`): from "Just nu" beside the list, from the person's Behöver dig over
 * the person; the list never gives way to Hem for it.
 * A source that does not answer is said once, with Försök igen; the rest stands.
 *
 * Someone who manages nobody gets an empty list from the server, and the page says whom it is for. One person's
 * utvecklingssamtal stays a drawer over this list at `/staff?talk=<personId>` (D96), reached from its source's page way
 * in ("Öppna samtalet"); the drawer reads its own data. An action from a row's menu starts on the server and opens its
 * card in the page's panel beside the list, over the person when one is open beside it (`entity-actions.ts`, D107
 * rule 4); a source's refusal is said aloud and stands over the list until the next action.
 */
export function StaffPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const manager = user.role === 'manager';
  const nav = useRail({ current: { surface: 'staff' }, admin, manager });
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const listQ = useQuery(entityListQuery('person'));
  const list = listQ.data;
  const read = useMemo(() => (list ? sourcesRead(list) : []), [list]);
  const rowsQs = useQueries({ queries: read.map(c => entityRowsQuery('person', c)) });
  const answers = new Map<string, Answer>(read.map((c, i) => [c, answerOf(rowsQs[i]?.data, !!rowsQs[i]?.isError)]));
  const lens = list?.lenses.find(l => l.capability === search.get(SHOW));
  // A decision made on a card beside the list changes what "Just nu" and the person's Behöver dig count: both are read
  // again, the sources' own rows are not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.list('person') });
    void client.invalidateQueries({
      queryKey: ['entities', 'person', 'detail'],
      predicate: q => q.queryKey.length === 4,
    });
  }, [client]);
  const person = usePersonPanel();
  // 1.4.10: on a short screen nothing is pinned beside the page, as on a tool's page. One thing at a time: what the
  // address opens takes the person's place, and the list's link is the way back to it.
  const panel = usePagePanel({
    under: person.frame,
    minMain: LIST_MIN,
    size: PERSON_PANEL,
    replaces: true,
    overlayOnly: short,
    onChange: cardChanged,
  });
  // The row the open thing is about, marked in the compact list: the opened person, else the person whose one card it is.
  const cardId = search.get('card') ?? undefined;
  const marked = person.person ?? (cardId ? list?.attention.find(a => a.threadId === cardId)?.key : undefined);
  const groups = list?.groups ?? [];
  const action = useEntityAction();

  // The open talk names the tab itself (the drawer, D96); the list's name is not spoken again when the focus comes back.
  // A person open beside the list names the tab with the list ("Johan Byström · Personal"); the panel's heading takes
  // the focus and says the name, so neither is spoken again.
  const talkId = talkOf(search);
  const sawTalk = useRef(false);
  if (talkId || person.person) sawTalk.current = true;
  usePageTitle(
    talkId ? null : person.name ? `${person.name} · Personal` : 'Personal',
    sawTalk.current ? false : 'Personal',
  );

  const openerEls = useRef(new Map<string, HTMLElement>());
  const openers = useCallback<Openers>(
    id => el => {
      if (!id) return;
      if (el) openerEls.current.set(id, el);
      else openerEls.current.delete(id);
    },
    [],
  );
  const opener = useCallback((personId: string) => openerEls.current.get(personId) ?? null, []);

  const choose = (capability: string | null) => {
    const next = new URLSearchParams(search);
    if (capability) next.set(SHOW, capability);
    else next.delete(SHOW);
    const q = next.toString();
    navigate({ search: q ? `?${q}` : '' });
  };
  // What the page draws waits for: the list, and the sources it shows (all of them on "Alla", the lens under a lens).
  const shown = lens ? [lens.capability] : read;
  const pending = listQ.isPending || shown.some(c => answers.get(c)?.status === 'pending');
  const silent = list ? silentOf(list, answers, shown) : [];
  // Försök igen asks again only the sources on the page that did not answer; the others stand as they are.
  const unanswered = read.flatMap((c, i) => (shown.includes(c) && answers.get(c)?.status !== 'ok' ? [rowsQs[i]] : []));
  const retry = () => unanswered.forEach(q => void q?.refetch());
  const retrying = unanswered.some(q => q?.isFetching);
  const ctx: Context | null = list ? { list, answers, openers, start: action.start } : null;

  // The list glides when a lens reorders it or the content swaps (Astryx's useAnimatedLayout), within the page.
  const root = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: root });
  const lensAnswer = lens ? answers.get(lens.capability) : undefined;
  const lensSilent = !!lens && lensAnswer?.status !== 'ok' && lensAnswer?.status !== 'pending';
  // The list is drawn whole again in the same step as the person or what lies over them closes, so the row that opened
  // them is there to take the focus back.
  const compact = panel.occupied && (!!person.person || !!panel.ref);
  const silentLine = <SilentSources silent={silent} retrying={retrying} onRetry={retry} />;

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* The layout fills the window, as on a tool's page, so the list and the person beside it scroll on their own and the handle's divider stands the height of the page (Astryx's side-panels guide). On a short window nothing is pinned and the page scrolls as one (1.4.10). */}
      {/* The list's column is bounded here, not with the Layout's `contentWidth`: that frames the panel with the
          content (Astryx: "the panel stays aligned to the contentWidth frame"), and on a wide window the panel then
          stood in from the window's edge with nothing beside it (the product owner, 2026-11-11). The panel docks to
          the edge as on Hem, and the column keeps the page's 1216 px less its padding, centred in what is left. */}
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} ref={root} width="100%" maxWidth={COLUMN}>
                <PageHeader
                  title="Personal"
                  meta={!compact && groups.length > 0 ? <Text type="supporting">{peopleLine(groups)}</Text> : undefined}
                />
                {/* The Visa menu under the title, where the list it changes starts (artboards A2, B and C). */}
                {list && groups.length > 0 && list.lenses.length > 0 && (
                  <HStack>
                    <ShowMenu lenses={list.lenses} answers={answers} lens={lens} onChoose={choose} />
                  </HStack>
                )}
                {listQ.isError ? (
                  <VStack gap={2}>
                    <Text as="p" role="alert">
                      {errorMessage(listQ.error, 'Listan kunde inte läsas.')}
                    </Text>
                    <HStack>
                      <Button
                        size="sm"
                        variant="secondary"
                        label="Försök igen"
                        isLoading={listQ.isFetching}
                        onClick={() => void listQ.refetch()}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <AsyncContent pending={pending} fallback={<ContentSkeleton />} gap={5}>
                    {/* A source's refusal of an action from a row's menu, said aloud as it came (entity-actions.ts). */}
                    {action.error && <Text as="p">{action.error}</Text>}
                    {ctx && groups.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inga medarbetare att visa"
                          description="Här ser den som är chef för en enhet medarbetarna på den. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                          actions={<Button label="Till startsidan" href="/" />}
                        />
                      </Card>
                    ) : ctx && compact ? (
                      <>
                        {silentLine}
                        {groups.map(g => (
                          <CompactUnit
                            key={g.id}
                            group={g}
                            lens={lens}
                            ctx={ctx}
                            opened={marked}
                            animatedLayout={animatedLayout}
                          />
                        ))}
                      </>
                    ) : ctx && lens ? (
                      <>
                        <VStack gap={1}>
                          <Heading level={2}>
                            {(lensAnswer?.status === 'ok' && lensAnswer.heading) || lens.title}
                          </Heading>
                          <Text type="supporting">
                            {[
                              lensAnswer?.status === 'ok' ? lensAnswer.note : undefined,
                              lensAnswer?.status === 'ok' ? valueCounts(lens.view, lensAnswer.all) : undefined,
                              // Clew's own domain is named as Clew (artboard B), any other source by its name.
                              lens.own ? 'Clew' : lens.source,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </VStack>
                        {/* A lens whose source did not answer has nothing to list: the sentence takes the table's place. */}
                        {lensSilent
                          ? silentLine
                          : groups.map(g => (
                              <LensUnit
                                key={g.id}
                                group={g}
                                lens={lens}
                                ctx={ctx}
                                mobile={mobile}
                                animatedLayout={animatedLayout}
                              />
                            ))}
                      </>
                    ) : ctx ? (
                      <>
                        {silentLine}
                        {groups.map(g => (
                          <AllUnit key={g.id} group={g} ctx={ctx} mobile={mobile} animatedLayout={animatedLayout} />
                        ))}
                      </>
                    ) : null}
                  </AsyncContent>
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
      {manager && <TalkOverlay opener={opener} />}
    </Shell>
  );
}
