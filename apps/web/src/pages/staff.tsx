import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, StaffPerson, StaffUnit, TalksResult } from '@clew/contracts';
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
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { staffQuery, talksQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { talkHref, talkOf } from '../talk-address';
import { dayText, talkAtText, talkFor, talkStatus, type TalkEntry } from '../talks';
import { useRail } from '../components/nav';
import { Shell, mobileQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { TalkOverlay } from '../components/talk-overlay';
import { roleOfOne } from './admin/labels';

/**
 * Personal (D94): the people on the units the signed-in manager manages, as the directory pushed them: name, user
 * name, role on the unit, address, and a mark when the directory has deactivated someone. One card per unit, a Table
 * on a desktop and List rows on a phone, as Användare (D85), in the same Layout as the administration (D74). Read
 * only; the scope is the server's, which answers 403 to anyone who manages no unit, and the page says so.
 *
 * Utvecklingssamtal (D96 item 7): while a round is open, each person in it also has the state of their talk as a badge,
 * when it is booked or was held, the number of open action points, and Samtal, which opens their talk as a drawer over
 * this list at `/staff?talk=<personId>` (`TalkOverlay`); a missing talk also has Boka, to the calendar's week. When
 * another system answers the profile, the same columns are read-only and Samtal opens that system. No talks system, or
 * no open round, and the page is as D94 drew it.
 */
interface Row extends Record<string, unknown> {
  id: string;
  p: StaffPerson;
  talk: TalkEntry | null;
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
  { key: 'role', header: 'Roll', width: pixel(140), renderCell: (r: Row) => <Text>{roleOfOne[r.p.role]}</Text> },
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
}: {
  unit: StaffUnit;
  mobile: boolean;
  round: Round | null;
  search: URLSearchParams;
  openers: Openers;
}) {
  const n = unit.people.length;
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
                      {roleOfOne[p.role]}
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
                  </VStack>
                }
                endContent={!p.enabled ? <Badge variant="neutral" label="Avstängd" /> : undefined}
              />
            );
          })}
        </List>
      ) : (
        <Table<Row>
          data={unit.people.map(p => ({ id: p.id, p, talk: round ? talkFor(p.id, round) : null }))}
          idKey="id"
          columns={[...columns, ...talkColumns]}
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
  // Someone who is not a manager gets the page's own answer without a call the server would refuse anyway.
  const query = useQuery({ ...staffQuery, enabled: manager });
  // Null is no talks system: the page is as before, with no error. A failure says so beside the list, which stays.
  const talksQ = useQuery({ ...talksQuery, enabled: manager });
  const units = query.data?.units ?? [];
  const people = units.reduce((sum, u) => sum + u.people.length, 0);
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
                    Medarbetarna på enheterna du är chef för, med roll och kontaktuppgift, som katalogen har fört in
                    dem.
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
                    <UnitCard key={u.unitId} unit={u} mobile={mobile} round={round} search={search} openers={openers} />
                  ))}
                </AsyncContent>
              )}
            </VStack>
          </LayoutContent>
        }
      />
      {manager && <TalkOverlay opener={opener} />}
    </Shell>
  );
}
