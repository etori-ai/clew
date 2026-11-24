import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { EntityList, SessionUser } from '@clew/contracts';
import {
  Button,
  EmptyState,
  FigureRow,
  HStack,
  KeyFigure,
  SECTION_GAP,
  Text,
  TextInput,
  useAnimatedLayout,
  useMediaQuery,
  VStack,
} from '@clew/ui';
import { entityListQuery, entityRowsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { mobileQuery } from '../components/shell/shell';
import { AsyncContent, ContentSkeleton } from '../components/shell/loading';
import { RegisterHolding } from '../components/people/register-holding';
import { AskClew } from '../components/conversation/thing-panel';
import { useEntityAction } from '../entity-actions';
import { fromCardsBeside, fromPersonBeside, insideClew, overlayRedirect, sourceTab } from '../person-address';
import { peopleReadHref } from '../view-address';
import { answerOf, lensNeed, peopleCount, silentOf, sourcesRead, valueCounts, type Answer } from './staff-model';
import {
  ALL_TAB,
  AllUnit,
  LensBadge,
  LensUnit,
  PersonalFrame,
  SHOW,
  SilentSources,
  type Context,
  type Openers,
  lensHref,
  usePeopleReads,
} from './staff-parts';

/**
 * Personal at `/staff`. A person, a talk and a work item are each a page (D111 rule 3, D126 rules 1 and 3): an address
 * that drew a person beside the list (`?person=<key>`) or listed their cards (`?cards=<key>`), bookmarked or sent before
 * 2026-11-11, leads to the person's page; one that laid a talk over the list (`?talk=<personId>`) leads to the person's
 * talk tab, with the list as the way back. Each is replaced, so Back returns to where the person was before.
 */
export function StaffPage(props: { user: SessionUser; admin: boolean }) {
  const { pathname, search } = useLocation();
  const list = useQuery({ ...entityListQuery('person'), enabled: new URLSearchParams(search).has('talk') }).data;
  const talk = list?.lenses.find(l => sourceTab(l.page) === 'talk')?.capability;
  const moved =
    fromPersonBeside(pathname, search) ??
    fromCardsBeside(pathname, search) ??
    overlayRedirect(pathname, search, talk ? { talk } : undefined);
  return moved ? <Navigate to={moved} replace /> : <Personal {...props} />;
}

const parseInput = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
/**
 * A read's page (`/tools/<capability>`) that is about the reader's people (D126 rules 1 and 8): a lens is Personal's tab
 * for it, and a lens's fuller read about one person is that person's page at the lens's tab (`peopleReadHref`), so a
 * tile on Hem, an answer's "Visa allt", the search and an address from before all lead there, replaced in the history.
 * Any other read is its own page (`children`). Nothing is drawn while the reader's people are on their way, so the
 * tool's page does not flash before the person's; someone who manages nobody has no lens and goes straight on.
 */
export function PeopleReadRoute({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { capability = '' } = useParams<{ capability: string }>();
  const [search] = useSearchParams();
  const manager = user.role === 'manager';
  const listQ = useQuery({ ...entityListQuery('person'), enabled: manager });
  const reads = usePeopleReads(capability, manager);
  if (!manager || listQ.isError) return <>{children}</>;
  if (!reads) return null;
  const href = peopleReadHref(
    { capability, input: parseInput(search.get('input')) },
    reads,
    insideClew(search.get('from')),
  );
  if (href === undefined) return null;
  return href ? <Navigate replace to={href} /> : <>{children}</>;
}

/** The people of a group whose name holds every word of the search, in the directory's order. */
function matching(list: EntityList, words: string): EntityList['groups'] {
  const terms = words.toLocaleLowerCase('sv-SE').split(/\s+/).filter(Boolean);
  if (!terms.length) return list.groups;
  return list.groups.map(g => ({
    ...g,
    entities: g.entities.filter(e => {
      const name = e.name.toLocaleLowerCase('sv-SE');
      return terms.every(t => name.includes(t));
    }),
  }));
}

/**
 * Personal (D94, D97; D126 rule 8, board Personal): one register of the people the reader may ask about, its views of
 * the same people as tabs (`PersonalFrame`). Personal knows no feature: what it shows of a person comes from the sources
 * that say their rows are about a person, placed by Clew. "Medarbetare" has the columns an administrator chose, each the
 * field of one source with the source under its label, and "Just nu" with the work items and the fields of the chosen
 * sources that need the reader. A lens's tab (`?show=<capability>`) is that source's view, sorted by need. Each row's
 * name is the link to the person's page (Avatar, name, title); its actions are in its menu, which opens the action
 * dialog (`entity-actions.ts`): nothing is created before the dialog's last button. A source that does not answer is
 * said once, with Försök igen; the rest stands. The search field narrows the rows by name; its words are the page's own
 * and never in its address, which an access log and the browser's history keep, nor in the way back (`from`) a person's
 * page is given: they are a person's name (D100 item 5). A reload, or a visit to a person and back, forgets them.
 *
 * Someone who manages nobody gets an empty list from the server, and the page says whom it is for. On a phone the people
 * are rows, so the page never scrolls sideways (1.4.10).
 */
function Personal({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const [search] = useSearchParams();
  const listQ = useQuery(entityListQuery('person'));
  const list = listQ.data;
  const read = useMemo(() => (list ? sourcesRead(list) : []), [list]);
  const rowsQs = useQueries({ queries: read.map(c => entityRowsQuery('person', c)) });
  const answers = new Map<string, Answer>(read.map((c, i) => [c, answerOf(rowsQs[i]?.data, !!rowsQs[i]?.isError)]));
  const lens = list?.lenses.find(l => l.capability === search.get(SHOW));
  // The people are rows on a phone; wider, the table, which scrolls sideways within its card where its columns do not
  // fit (a data table's exception in 1.4.10), as it did before the panel left the page.
  const narrow = mobile;
  const [words, type] = useState('');
  const groups = useMemo(() => (list ? matching(list, words) : []), [list, words]);
  const found = groups.some(g => g.entities.length > 0);
  const total = list ? peopleCount(list.groups) : 0;
  const action = useEntityAction();
  usePageTitle(lens ? `${lens.title} · Personal` : 'Personal');

  // Each person's link, by Clew's id, so a dialog closed from an address can give the focus back to it.
  const openerEls = useRef(new Map<string, HTMLElement>());
  const openers = useCallback<Openers>(
    id => el => {
      if (!id) return;
      if (el) openerEls.current.set(id, el);
      else openerEls.current.delete(id);
    },
    [],
  );
  // What the page draws waits for: the list, and the sources it shows (all of them on Medarbetare, the lens under a lens).
  const shown = lens ? [lens.capability] : read;
  const pending = listQ.isPending || shown.some(c => answers.get(c)?.status === 'pending');
  const silent = list ? silentOf(list, answers, shown) : [];
  // Försök igen asks again only the sources on the page that did not answer; the others stand as they are.
  const unanswered = read.flatMap((c, i) => (shown.includes(c) && answers.get(c)?.status !== 'ok' ? [rowsQs[i]] : []));
  const retry = () => unanswered.forEach(q => void q?.refetch());
  const retrying = unanswered.some(q => q?.isFetching);
  const ctx: Context | null = list ? { list, answers, openers, start: action.start } : null;

  // The list glides when a lens reorders it or the search narrows it (Astryx's useAnimatedLayout), within the page.
  const root = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: root });
  const lensAnswer = lens ? answers.get(lens.capability) : undefined;
  const lensSilent = !!lens && lensAnswer?.status !== 'ok' && lensAnswer?.status !== 'pending';
  const silentLine = <SilentSources silent={silent} retrying={retrying} onRetry={retry} />;
  const badges = new Map(
    (list?.lenses ?? []).map(l => [
      l.capability,
      <LensBadge key={l.capability} lens={l} answer={answers.get(l.capability)} />,
    ]),
  );
  const single = groups.length === 1;
  // A lens's own line (artboard B): its heading, its note, its counts and its source, before its table.
  const lensLine = lens
    ? [
        lensAnswer?.status === 'ok' ? lensAnswer.heading : undefined,
        lensAnswer?.status === 'ok' ? lensAnswer.note : undefined,
        lensAnswer?.status === 'ok' ? valueCounts(lens.view, lensAnswer.all) : undefined,
        // Clew's own domain is named as Clew (artboard B), any other source by its name.
        lens.own ? 'Clew' : lens.source,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // "Fråga assistenten" on a lens's tab (D126 rule 5): a conversation about the people under that lens (`?lens=`).
  const ask = lens ? (
    <AskClew
      subject={{
        key: `lens:${lens.capability}`,
        label: lens.title.toLocaleLowerCase('sv-SE'),
        chips: [],
        search: `?lens=${encodeURIComponent(lens.capability)}`,
      }}
    />
  ) : null;
  // One unit's register has its search inside its card (D130 item 16); several units share one in the page's header.
  const inCard = !lens && single;
  const searchRef = useRef<HTMLInputElement>(null);
  const searchField =
    total > 0 ? (
      <TextInput
        ref={searchRef}
        type="search"
        label="Sök medarbetare"
        isLabelHidden
        placeholder="Sök medarbetare"
        value={words}
        onChange={type}
        hasClear
        autoComplete="off"
        size={inCard ? 'lg' : 'md'}
        width={mobile ? '100%' : inCard ? 480 : 260}
      />
    ) : undefined;
  const noMatches = (
    <EmptyState
      headingLevel={2}
      title="Ingen medarbetare heter så"
      description="Sök på en del av förnamnet eller efternamnet."
      actions={
        <Button
          label="Visa alla"
          onClick={() => {
            type('');
            searchRef.current?.focus();
          }}
        />
      }
    />
  );
  // The unit's key figures over the register (D130 item 16), as the reference opens Personal: how many people it
  // lists, and for each lens how many of them need the reader, in that need's colour, leading to the lens.
  const figures =
    list && !lens && total > 0 ? (
      <FigureRow>
        <KeyFigure
          label="Medarbetare"
          value={String(total)}
          name={`Medarbetare ${total}`}
          // Where they are: the unit, or how many units. The page's line under its title says the rest.
          foot={list.groups.length === 1 ? list.groups[0]!.label : `${list.groups.length} enheter`}
        />
        {list.lenses.map(l => {
          const answer = answers.get(l.capability);
          if (answer?.status !== 'ok') return null;
          const need = lensNeed(l, answer);
          const n = need?.count ?? 0;
          return (
            <KeyFigure
              key={l.capability}
              label={l.title}
              value={String(n)}
              tone={need ? (need.tone === 'alert' ? 'error' : 'warning') : undefined}
              line={n ? 'behöver dig' : 'Ingen behöver dig'}
              foot={l.own ? 'Clew' : l.source}
              href={lensHref(l.capability)}
              name={`${l.title}: ${n} medarbetare behöver dig`}
            />
          );
        })}
      </FigureRow>
    ) : null;

  return (
    <PersonalFrame
      user={user}
      admin={admin}
      tab={lens?.capability ?? ALL_TAB}
      end={
        <>
          {inCard ? null : searchField}
          {ask}
        </>
      }
      badges={badges}
      label={lens ? lens.title : 'Medarbetare'}
    >
      <VStack gap={SECTION_GAP} ref={root}>
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
          <AsyncContent pending={pending} fallback={<ContentSkeleton />} gap={SECTION_GAP}>
            {/* A source's refusal of an action from a row's menu, said aloud as it came (entity-actions.ts). */}
            {(action.error || silent.length > 0 || lensLine) && (
              <VStack gap={2}>
                {action.error && <Text as="p">{action.error}</Text>}
                {lensLine && <Text type="supporting">{lensLine}</Text>}
                {silentLine}
              </VStack>
            )}
            {action.dialog}
            {found && figures}
            {ctx && total === 0 ? (
              <EmptyState
                headingLevel={2}
                title="Inga medarbetare att visa"
                description="Här ser den som är chef för en enhet medarbetarna på den. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                actions={<Button label="Till startsidan" href="/" />}
              />
            ) : ctx && !found && !inCard ? (
              noMatches
            ) : ctx && lens ? (
              // A lens whose source did not answer has nothing to list: the sentence above takes the table's place.
              lensSilent ? null : (
                groups.map(g => (
                  <LensUnit
                    key={g.id}
                    group={g}
                    single={single}
                    lens={lens}
                    ctx={ctx}
                    narrow={narrow}
                    animatedLayout={animatedLayout}
                  />
                ))
              )
            ) : ctx ? (
              groups.map(g => (
                <AllUnit
                  key={g.id}
                  group={g}
                  single={single}
                  ctx={ctx}
                  narrow={narrow}
                  animatedLayout={animatedLayout}
                  tools={inCard ? searchField : undefined}
                  empty={found ? undefined : noMatches}
                />
              ))
            ) : null}
          </AsyncContent>
        )}
      </VStack>
      {/* Registrera intyg (D108 item 7) from an address that named it here: a dialog over the register, closed with a replace. */}
      {user.role === 'manager' && <RegisterHolding />}
    </PersonalFrame>
  );
}
