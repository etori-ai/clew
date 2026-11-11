import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ABOUT_KEYS_MAX,
  type AboutResult,
  type SessionUser,
  type StaffPerson,
  type StaffUnit,
  type TalksResult,
  type ViewRef,
} from '@clew/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Layout,
  LayoutContent,
  Link,
  List,
  ListItem,
  MoreMenu,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { aboutQuery, competenceTypesQuery, staffQuery, talksQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { talkHref, talkOf } from '../talk-address';
import { withView, withoutPanel } from '../panel-address';
import { marksFor, unanswered, type Mark } from '../about';
import { registerHref } from '../register-address';
import { RegisterHolding } from '../components/register-holding';
import { dayText, talkAtText, talkFor, talkStatus, type TalkEntry } from '../talks';
import { useRail } from '../components/nav';
import { Shell, mobileQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { TalkOverlay } from '../components/talk-overlay';
import { PanelBody, usePanel, type PanelFrame } from '../components/panel';
import { useView } from '../components/use-view';
import { roleText } from './admin/labels';

/**
 * Personal (D94, D99): the signed-in manager's reports, as the directory pushed them: the people on the units they
 * manage and, down the organisation tree, the managers directly below, each with the unit they lead; name, user name,
 * role, address, and a mark when the directory has deactivated someone. One card per unit, a Table
 * on a desktop and List rows on a phone, as Användare (D85), in the same Layout as the administration (D74). Read
 * only; the scope is the server's, which answers 403 to anyone who manages no unit, and the page says so.
 *
 * Utvecklingssamtal (D96 item 7): while a round is open, each person in it also has the state of their talk as a badge,
 * when it is booked or was held, the number of open action points, and Samtal, which opens their talk as a drawer over
 * this list at `/staff?talk=<personId>` (`TalkOverlay`); a missing talk also has Boka, to the calendar's week. When
 * another system answers the profile, the same columns are read-only and Samtal opens that system. No talks system, or
 * no open round, and the page is as D94 drew it.
 *
 * What the sources say about a person (D97 items 2 and 5): the page asks `clew.about` once for everyone it lists. Where
 * a source gives a status a warning or an alert tone, the person's row has a mark under Behöver dig: the status as a
 * badge and the source's name as a link that opens the source's own view of that person in the panel, over the list
 * (D83: a record opened from a tool keeps the tool underneath; the address names it, `?open=…`). The page knows no
 * source by name. With no source about people the column is not there; a source that did not answer is named once.
 *
 * Registrera intyg (D101 item 7): while Clew's own competence module is on for the manager and its catalogue has a type,
 * each person who is not deactivated has a menu of actions with it, which opens the form as a dialog over the list at
 * `?register=<personId>` (`RegisterHolding`). The menu is the person's one place for actions (D97 item 2), not a button
 * per feature on the row.
 */
interface Row extends Record<string, unknown> {
  id: string;
  p: StaffPerson;
  talk: TalkEntry | null;
  marks: Mark[];
}
/** The address that registers a certificate for this person, or undefined when that is not offered to the reader. */
type RegisterHref = ((personId: string) => string) | undefined;
/** A person's actions: one menu named for the person, there only when there is an action for them. */
function PersonMenu({ person, registerFor }: { person: StaffPerson; registerFor: RegisterHref }) {
  if (!registerFor || !person.enabled) return null;
  return (
    <MoreMenu
      label={`Åtgärder för ${person.name}`}
      size="sm"
      alignment="end"
      presentation="adaptive"
      items={[{ label: 'Registrera intyg', href: registerFor(person.id) }]}
    />
  );
}
/** The address of the page with a source's view of one person in the panel. */
type MarkHref = (view: ViewRef) => string;
const markTone = { warn: 'warning', alert: 'error' } as const;
/**
 * A person's marks: for each, the status as a badge and the source as the way in, named for the person so that a row
 * of them is told apart by a screen reader. A mark whose source declares no fuller view is the badge and the name.
 */
function Marks({ person, marks, hrefFor }: { person: StaffPerson; marks: Mark[]; hrefFor: MarkHref }) {
  if (!marks.length) return null;
  return (
    <VStack gap={2} hAlign="start">
      {marks.map(m => (
        <HStack key={m.id} gap={2} vAlign="center" wrap="wrap">
          <Badge variant={markTone[m.tone]} label={m.word} />
          {m.view ? (
            <Button
              size="sm"
              variant="ghost"
              label={m.title}
              aria-label={`${m.title} för ${person.name}: ${m.word}`}
              href={hrefFor(m.view)}
            />
          ) : (
            <Text type="supporting">{m.title}</Text>
          )}
        </HStack>
      ))}
    </VStack>
  );
}
/** What the list knows of the round: the answer while a round is open, null otherwise (no talks system, no round). */
type Round = TalksResult & { round: NonNullable<TalksResult['round']> };
/** Each person's control that opens their talk, so the drawer can give the focus back to it after a reload. */
type Openers = (personId: string) => (el: HTMLElement | null) => void;

const who = (p: StaffPerson) => (
  <HStack gap={2} vAlign="center">
    <Avatar name={p.name} size="sm" tooltip={false} />
    <VStack gap={0} hAlign="start">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text weight="semibold">{p.name}</Text>
        {!p.enabled && <Badge variant="neutral" label="Avstängd" />}
      </HStack>
      <Text type="code" color="secondary">
        {p.userName ?? p.id}
      </Text>
    </VStack>
  </HStack>
);
const columns = [
  { key: 'person', header: 'Person', width: proportional(2, { minWidth: 240 }), renderCell: (r: Row) => who(r.p) },
  {
    key: 'role',
    header: 'Roll',
    width: proportional(1, { minWidth: 140 }),
    renderCell: (r: Row) => <Text>{roleText(r.p)}</Text>,
  },
  {
    key: 'email',
    header: 'E-post',
    width: proportional(2, { minWidth: 200 }),
    renderCell: (r: Row) => (r.p.email ? <Text>{r.p.email}</Text> : <Text color="secondary">Saknas</Text>),
  },
];
/** "2 åtgärdspunkter": the open ones, from this round and earlier ones. */
const openPoints = (n: number) => `${n} ${n === 1 ? 'åtgärdspunkt' : 'åtgärdspunkter'}`;
/** The state as a badge and, when there is one, the day or time beside it. */
const talkState = (talk: TalkEntry) => {
  const when = talkAtText(talk);
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Badge {...talkStatus(talk.state)} />
      {when && <Text type="supporting">{when}</Text>}
    </HStack>
  );
};
/**
 * The ways into one person's talk. Clew's own module: Samtal, a link to the drawer named for the person, and Boka to
 * the calendar's week when the talk is missing (there is no booking for one person yet, D96). Another system: Samtal
 * opens the talk there, in a new tab, as a row of the errand list opens its system.
 */
function TalkLinks({
  person,
  talk,
  round,
  search,
  opener,
}: {
  person: StaffPerson;
  talk: TalkEntry;
  round: Round;
  search: URLSearchParams;
  opener: (el: HTMLElement | null) => void;
}) {
  if (!round.writable)
    return talk.link ? (
      <Link
        href={talk.link}
        isExternalLink
        label={`Samtal med ${person.name} i ${round.source} (öppnas i ny flik)`}
        newTabLabel="(öppnas i ny flik)"
      >
        Samtal
      </Link>
    ) : null;
  return (
    <HStack gap={2} wrap="wrap">
      <Button
        ref={opener}
        size="sm"
        variant="secondary"
        label="Samtal"
        aria-label={`Samtal med ${person.name}`}
        href={talkHref(person.id, search)}
      />
      {talk.state === 'missing' && (
        <Button
          size="sm"
          variant="ghost"
          label="Boka"
          aria-label={`Boka samtal med ${person.name}`}
          href="/calendar?view=week"
        />
      )}
    </HStack>
  );
}
function UnitCard({
  unit,
  mobile,
  round,
  search,
  openers,
  about,
  markHref,
  registerFor,
}: {
  unit: StaffUnit;
  mobile: boolean;
  round: Round | null;
  search: URLSearchParams;
  openers: Openers;
  /** What the sources answered about the people listed; null when no source about people answers for the reader. */
  about: AboutResult | null;
  markHref: MarkHref;
  registerFor: RegisterHref;
}) {
  const n = unit.people.length;
  // The column is there when a source about people is: a list where nobody needs the manager says so by being empty.
  const markColumns = about?.sections?.length
    ? [
        {
          key: 'marks',
          header: 'Behöver dig',
          width: proportional(2, { minWidth: 200 }),
          renderCell: (r: Row) => <Marks person={r.p} marks={r.marks} hrefFor={markHref} />,
        },
      ]
    : [];
  const links = (p: StaffPerson, talk: TalkEntry) =>
    round && <TalkLinks person={p} talk={talk} round={round} search={search} opener={openers(p.id)} />;
  // The round's columns, only while a round is open; a person outside the round has empty cells there, no badge.
  const talkColumns = round
    ? [
        {
          key: 'talk',
          header: 'Samtal',
          width: proportional(2, { minWidth: 200 }),
          renderCell: (r: Row) =>
            r.talk && (
              <VStack gap={2} hAlign="start">
                {talkState(r.talk)}
                {links(r.p, r.talk)}
              </VStack>
            ),
        },
        {
          key: 'points',
          header: 'Åtgärdspunkter',
          width: pixel(140),
          align: 'end' as const,
          renderCell: (r: Row) => r.talk && <Text hasTabularNumbers>{r.talk.openCommitments}</Text>,
        },
      ]
    : [];
  const actionColumns = registerFor
    ? [
        {
          key: 'actions',
          header: 'Åtgärder',
          width: pixel(96),
          align: 'end' as const,
          renderCell: (r: Row) => <PersonMenu person={r.p} registerFor={registerFor} />,
        },
      ]
    : [];
  return (
    <Card padding={0}>
      <Toolbar
        label={unit.unitLabel}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">{unit.unitLabel}</Text>
            <Text type="supporting">{n === 0 ? 'Ingen medarbetare' : `${n} medarbetare`}</Text>
          </VStack>
        }
      />
      {n === 0 ? (
        <EmptyState
          isCompact
          title="Ingen medarbetare på enheten"
          description="Katalogen har inte fört in någon annan än dig på den här enheten."
        />
      ) : mobile ? (
        <List aria-label={unit.unitLabel} hasDividers>
          {unit.people.map(p => {
            const talk = round ? talkFor(p.id, round) : null;
            return (
              <ListItem
                key={p.id}
                startContent={<Avatar name={p.name} size="sm" tooltip={false} />}
                label={<Text weight="semibold">{p.name}</Text>}
                description={
                  <VStack gap={1} hAlign="start">
                    <Text type="code" color="secondary">
                      {p.userName ?? p.id}
                    </Text>
                    <Text type="supporting">
                      {roleText(p)}
                      {p.email ? ` · ${p.email}` : ''}
                    </Text>
                    {talk && (
                      <>
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          {talkState(talk)}
                          <Text type="supporting">{openPoints(talk.openCommitments)}</Text>
                        </HStack>
                        {links(p, talk)}
                      </>
                    )}
                    <Marks person={p} marks={marksFor(about, p.id)} hrefFor={markHref} />
                  </VStack>
                }
                endContent={
                  !p.enabled ? (
                    <Badge variant="neutral" label="Avstängd" />
                  ) : registerFor ? (
                    <PersonMenu person={p} registerFor={registerFor} />
                  ) : undefined
                }
              />
            );
          })}
        </List>
      ) : (
        <Table<Row>
          data={unit.people.map(p => ({
            id: p.id,
            p,
            talk: round ? talkFor(p.id, round) : null,
            marks: marksFor(about, p.id),
          }))}
          idKey="id"
          columns={[...columns, ...markColumns, ...talkColumns, ...actionColumns]}
          density="balanced"
          hasHover
        />
      )}
    </Card>
  );
}
export function StaffPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const manager = user.role === 'manager';
  const nav = useRail({ current: { surface: 'staff' }, admin, manager });
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Someone who is not a manager gets the page's own answer without a call the server would refuse anyway.
  const query = useQuery({ ...staffQuery, enabled: manager });
  // Null is no talks system: the page is as before, with no error. A failure says so beside the list, which stays.
  const talksQ = useQuery({ ...talksQuery, enabled: manager });
  const units = query.data?.units ?? [];
  const people = units.reduce((sum, u) => sum + u.people.length, 0);
  // Everyone listed, each once, asked about in one read (D97 item 7); the server drops whom the reader may not see.
  const listed = useMemo(
    () => [...new Set((query.data?.units ?? []).flatMap(u => u.people.map(p => p.id)))].slice(0, ABOUT_KEYS_MAX),
    [query.data],
  );
  // Null is no source about people: no column and no error. A failure says so beside the list, which stays.
  const aboutQ = useQuery({ ...aboutQuery(listed), enabled: manager && listed.length > 0 });
  const about = aboutQ.data ?? null;
  const silent = unanswered(about);
  // Null is the module switched off, or not the reader's to register in: no menu and no error.
  const typesQ = useQuery({ ...competenceTypesQuery, enabled: manager });
  const types = useMemo(() => (typesQ.data?.rows ?? []).filter(t => !t.archived), [typesQ.data]);
  const registerFor = useMemo<RegisterHref>(
    () => (types.length ? personId => registerHref(location.pathname, personId, search) : undefined),
    [types.length, location.pathname, search],
  );
  const registrable = useMemo(
    () => (query.data?.units ?? []).flatMap(u => u.people).filter(p => p.enabled),
    [query.data],
  );
  // A source's view of one person, opened from a mark: in the panel over the list, named in the address.
  const opened = manager ? search.get('open') : null;
  const side = useView(opened, search.get('open-input'), {
    title: search.get('open-title') ?? opened ?? '',
    via: search.get('via') === '1',
    address: location.pathname + location.search,
  });
  const detail = side.shown;
  const markHref = useCallback<MarkHref>(
    view => withView(location.pathname, search, view),
    [location.pathname, search],
  );
  const frame: PanelFrame | null = detail
    ? {
        id: `view:${detail.capability}`,
        title: detail.title,
        address: detail.address,
        wide: detail.spec?.kind === 'table',
        onClose: () => navigate(withoutPanel(location.pathname, search)),
        body: inline => (
          <PanelBody
            output={detail.output}
            view={detail.spec}
            input={detail.input}
            isLoading={side.isLoading}
            inline={inline}
            hrefFor={v => withView(location.pathname, search, v, true)}
            onBack={detail.via ? () => navigate(-1) : undefined}
          />
        ),
      }
    : null;
  // The list keeps its width: what a mark opens lies over it, as the panel does wherever both do not fit (D83).
  const slot = usePanel(frame, { minMain: 1060, overlayOnly: true });
  const talkId = talkOf(search);
  const talkPerson = talkId ? units.flatMap(u => u.people).find(p => p.id === talkId) : undefined;
  // The open talk names the tab; the overlay says its own name when the focus enters it, and the list's name is not
  // spoken again when the focus comes back to the list.
  const sawTalk = useRef(false);
  if (talkId) sawTalk.current = true;
  usePageTitle(
    talkPerson && talksQ.data?.writable ? `Samtal med ${talkPerson.name}` : 'Personal',
    sawTalk.current ? false : 'Personal',
  );
  const refused = !manager || (query.isError && errorMessage(query.error, '').includes('chef'));
  const error = query.isError && !refused ? errorMessage(query.error, 'Listan kunde inte läsas.') : null;
  const round = talksQ.data?.round ? (talksQ.data as Round) : null;
  const openerEls = useRef(new Map<string, HTMLElement>());
  const openers = useCallback<Openers>(
    personId => el => {
      if (el) openerEls.current.set(personId, el);
      else openerEls.current.delete(personId);
    },
    [],
  );
  const opener = useCallback((personId: string) => openerEls.current.get(personId) ?? null, []);
  return (
    <Shell user={user} nav={nav}>
      <Layout
        height="auto"
        contentWidth={1216}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={false}>
            <VStack gap={5}>
              <PageHeader
                title="Personal"
                meta={
                  <Text as="p" color="secondary">
                    De som rapporterar till dig: medarbetarna på enheterna du är chef för och cheferna närmast under,
                    med roll och kontaktuppgift, som katalogen har fört in dem.
                  </Text>
                }
              />
              {refused ? (
                <Card>
                  <EmptyState
                    headingLevel={2}
                    title="Sidan Personal är för chefer"
                    description="Här ser den som är chef för en enhet medarbetarna på den. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                    actions={<Button label="Till startsidan" href="/" />}
                  />
                </Card>
              ) : (
                <AsyncContent pending={query.isPending || talksQ.isPending} fallback={<ContentSkeleton />} gap={5}>
                  {error && (
                    <Text as="p" role="alert" color="accent">
                      {error}
                    </Text>
                  )}
                  {query.data && (
                    <VStack gap={1}>
                      <Text type="supporting" role="status">
                        {units.length === 1
                          ? `${people} medarbetare på ${units[0]!.unitLabel}`
                          : `${people} medarbetare på ${units.length} enheter`}
                      </Text>
                      {round && (
                        <Text type="supporting">
                          {round.round.label} · senast {dayText(round.round.dueOn)}
                          {round.writable ? '' : ` · samtalen finns i ${round.source}`}
                        </Text>
                      )}
                      {round?.bookedUnknown && (
                        <Text type="supporting" role="status">
                          Kalendern svarade inte, så ett bokat samtal kan visas som saknat.
                        </Text>
                      )}
                    </VStack>
                  )}
                  {aboutQ.isError && (
                    <Text as="p" role="alert">
                      {errorMessage(aboutQ.error, 'Det gick inte att hämta vad som behöver dig på listan.')}
                    </Text>
                  )}
                  {silent.length > 0 && (
                    <Text type="supporting" role="status">
                      {silent.join(', ')} svarade inte, så listan kan sakna markeringar därifrån.
                    </Text>
                  )}
                  {side.failed && (
                    <Text as="p" role="alert">
                      {errorMessage(side.failed, 'Det gick inte att öppna.')}
                    </Text>
                  )}
                  {talksQ.isError && (
                    <VStack gap={2}>
                      <Text as="p" role="alert">
                        {errorMessage(talksQ.error, 'Utvecklingssamtalen kunde inte hämtas.')}
                      </Text>
                      <HStack>
                        <Button
                          size="sm"
                          variant="secondary"
                          label="Försök igen"
                          isLoading={talksQ.isFetching}
                          onClick={() => void talksQ.refetch()}
                        />
                      </HStack>
                    </VStack>
                  )}
                  {units.map(u => (
                    <UnitCard
                      key={u.unitId}
                      unit={u}
                      mobile={mobile}
                      round={round}
                      search={search}
                      openers={openers}
                      about={about}
                      markHref={markHref}
                      registerFor={registerFor}
                    />
                  ))}
                </AsyncContent>
              )}
            </VStack>
          </LayoutContent>
        }
      />
      {manager && <TalkOverlay opener={opener} />}
      {slot.overlay}
      {manager && <RegisterHolding pathname={location.pathname} people={registrable} types={types} />}
    </Shell>
  );
}
