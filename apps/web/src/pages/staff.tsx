import { useCallback, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
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
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { TalkOverlay } from '../components/talk-overlay';
import { RegisterHolding } from '../components/register-holding';
import { usePagePanel } from '../components/page-panel';
import { panelBesideQuery } from '../components/panel';
import { useEntityAction } from '../entity-actions';
import { fromCardsBeside, fromPersonBeside } from '../person-address';
import { answerOf, peopleLine, silentOf, sourcesRead, valueCounts, type Answer } from './staff-model';
import { AllUnit, LensUnit, SilentSources, ShowMenu, listMinWidth, type Context, type Openers } from './staff-parts';

/** The list's column at its widest: the page width the person's page also has (1216 px) less the 32 px padding on each side. */
const COLUMN = 1216 - 2 * 32;
/** The page's own padding on each side of the list, which the list's least width does not count. */
const PADDING = 32;
/** The lens in the address (D43, D83 rule 4): `?show=<capability>`; absent, or not a lens, is "Alla". */
const SHOW = 'show';

/**
 * Personal at `/staff`. A person is a page only (D111 rule 3): an address that drew a person beside the list
 * (`?person=<key>`, bookmarked or sent before 2026-11-11) leads to the person's page in its place, with the list as the
 * way back, so the person is never silently dropped. So does one that listed a person's cards beside it (`?cards=<key>`,
 * from the same day): to the person's page at Behöver dig, since the panel holds one opened thing.
 */
export function StaffPage(props: { user: SessionUser; admin: boolean }) {
  const { pathname, search } = useLocation();
  const moved = fromPersonBeside(pathname, search) ?? fromCardsBeside(pathname, search);
  return moved ? <Navigate to={moved} replace /> : <Personal {...props} />;
}

/**
 * Personal (D94, D97): the people the reader may ask about, one card per unit, as the canvas draws it (artboards A2,
 * B, A3). Personal knows no feature: what it shows of a person comes from the sources that say their rows are about a
 * person, placed by Clew. "Alla" has the columns an administrator chose, each the field of one source with the source
 * under its label, and "Just nu" with the fields of the chosen sources that need the reader. "Visa" picks a lens, a
 * source an administrator offers, and the list is then that source's view, sorted by need. Each row has its menu,
 * grouped by the system an action works in. A name leads to the person's page. Whatever is opened from the list
 * opens in the page's panel and the list stays beside it (D111 rules 2 and 3): the one card "Just nu" counts
 * (`?card=<threadId>`); several lead to the person's page at Behöver dig, since the panel holds one opened thing
 * (D111, amended 2026-11-11). The panel stands beside the list from the one width every page has (`BESIDE_FROM`), and
 * the list gives way: where its table no longer keeps its least width beside the panel, it is drawn as the rows a
 * phone draws. In a narrower window the panel is the drawer over the list. A source that does not answer is said once,
 * with Försök igen; the rest stands.
 *
 * Someone who manages nobody gets an empty list from the server, and the page says whom it is for. One person's
 * utvecklingssamtal is a drawer over the list as it stands, its lens and what its panel holds kept (`?talk=<personId>`,
 * D96, D111 rule 5), reached from its source's way in ("Öppna samtalet") in the row's menu; the drawer reads its own
 * data, and a cold `/staff?talk=<personId>` is the list with the talk over it. An action from a row's menu starts on
 * the server and opens its card in the page's panel (`entity-actions.ts`, D111 rule 4), and closing the card gives the
 * focus back to the row's menu button; a source's refusal is said aloud and stands over the list until the next action.
 */
function Personal({ user, admin }: { user: SessionUser; admin: boolean }) {
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
  // A decision made on a card beside the list changes what "Just nu" counts and what the person's page lists under
  // Behöver dig: the list and the person are read again, the sources' own rows are not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.list('person') });
    void client.invalidateQueries({
      queryKey: ['entities', 'person', 'detail'],
      predicate: q => q.queryKey.length === 4,
    });
  }, [client]);
  // 1.4.10: on a short screen nothing is pinned beside the page, as on a tool's page.
  const panel = usePagePanel({ overlayOnly: short, onChange: cardChanged });
  // The page gives way to the panel beside it (the product owner, 2026-11-11): where the whole table no longer keeps
  // its columns' widths beside the panel (the lens decides them), the list is the rows it is on a phone.
  const tableBeside = useMediaQuery(panelBesideQuery(listMinWidth(list, lens) + 2 * PADDING));
  const narrow = mobile || (panel.occupied && !tableBeside);
  const groups = list?.groups ?? [];
  const action = useEntityAction();

  // An open talk names the tab itself while it lies over the list (`useOverlayTitle`), and the list's name comes back.
  usePageTitle('Personal');

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
  const silentLine = <SilentSources silent={silent} retrying={retrying} onRetry={retry} />;

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* The layout fills the window, as on a tool's page, so the list and the panel beside it scroll on their own and the handle's divider stands the height of the page (Astryx's side-panels guide). On a short window nothing is pinned and the page scrolls as one (1.4.10). */}
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
                  meta={groups.length > 0 ? <Text type="supporting">{peopleLine(groups)}</Text> : undefined}
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
                    {action.dialog}
                    {ctx && groups.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inga medarbetare att visa"
                          description="Här ser den som är chef för en enhet medarbetarna på den. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                          actions={<Button label="Till startsidan" href="/" />}
                        />
                      </Card>
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
                                narrow={narrow}
                                animatedLayout={animatedLayout}
                              />
                            ))}
                      </>
                    ) : ctx ? (
                      <>
                        {silentLine}
                        {groups.map(g => (
                          <AllUnit key={g.id} group={g} ctx={ctx} narrow={narrow} animatedLayout={animatedLayout} />
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
      {manager && <TalkOverlay opener={opener} back="Tillbaka till Personal" />}
      {/* Registrera intyg (D108 item 7): the competence module's page for one person, a dialog over the list. */}
      {manager && <RegisterHolding />}
    </Shell>
  );
}
