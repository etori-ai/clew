import { useCallback, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { EntityDetail, EntityList, SessionUser } from '@clew/contracts';
import {
  Button,
  EmptyState,
  HStack,
  Layout,
  LayoutContent,
  Link,
  MetadataList,
  MetadataListItem,
  Skeleton,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, entityDetailQuery, entityListQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { NEEDS_YOU, insideClew, originOf, toolOf } from '../person-address';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { usePagePanel, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { TalkOverlay } from '../components/talk-overlay';
import {
  EntityPage,
  PageSection,
  RailSection,
  useAddressedSection,
  type PageSectionEntry,
} from '../components/entity-page';
import {
  EntityActions,
  NeedsYouRows,
  SourceBadge,
  SourceWay,
  UnitSourceBody,
  drawnSections,
  useSectionAnswers,
} from '../components/entity-sections';

/**
 * Whether the reader manages the unit and how many people it has: the people the reader may ask about come in one group
 * per unit they manage (`GET /api/entities/person`), so the unit's group says both. A manager whose list could not be
 * read still gets the count, saying so; anyone else gets none.
 */
function useStaffCount(user: SessionUser, id: string) {
  const read = useQuery(entityListQuery('person'));
  const group = read.data?.groups.find(g => g.id === id);
  const manages = group
    ? true
    : read.isError
      ? user.role === 'manager'
        ? null
        : false
      : read.isPending
        ? null
        : false;
  // `null`: not known yet, or not known at all (the list failed for a manager).
  const shown = manages === true || (manages === null && user.role === 'manager');
  return { read, manages, shown, count: group?.entities.length };
}
type StaffCount = ReturnType<typeof useStaffCount>;

/** The unit's head count as Clew's own list of the reader's people gives it, while it is on its way, and when it failed. */
function StaffValue({ count, read }: { count: number | undefined; read: UseQueryResult<EntityList, Error> }) {
  if (read.isPending) return <Skeleton height={20} width={120} />;
  if (count === undefined)
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text>Kunde inte hämtas.</Text>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          aria-label="Försök igen med Personal"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    );
  return <Text hasTabularNumbers>{count} medarbetare</Text>;
}

/**
 * The details rail of a unit's page (D112 item 5): "Detaljer", what the directory (Katalogen) says of the unit that the
 * page has: that it is a unit, the reader's role on it, and for a unit the reader manages how many people it has, with
 * the way to Personal as a link. The directory's tree (the unit above, the units below, their managers) does not reach
 * this page, so none of it is drawn.
 */
function UnitDetails({ staff }: { staff: StaffCount }) {
  return (
    <RailSection title="Detaljer" caption="Katalogen">
      <VStack gap={4}>
        <MetadataList>
          <MetadataListItem label="Typ">
            <Text>Enhet</Text>
          </MetadataListItem>
          {staff.manages !== null && (
            <MetadataListItem label="Din roll">
              <Text>{staff.manages ? 'Chef' : 'Medarbetare'}</Text>
            </MetadataListItem>
          )}
          {staff.shown && (
            <MetadataListItem label="Personal">
              <StaffValue count={staff.count} read={staff.read} />
            </MetadataListItem>
          )}
        </MetadataList>
        {staff.manages === true && (
          <HStack>
            <Link href="/staff" weight="semibold" isStandalone>
              Öppna Personal
            </Link>
          </HStack>
        )}
      </VStack>
    </RailSection>
  );
}

/**
 * The unit as a page (D112 item 5, the shape of board Person; D97 items 5 and 6), at `/units/:id`: the way back, its
 * name, its actions and "Fråga Clew" in the header; in the main column "Behöver dig" (the reader's work items about the
 * unit) and then every source about a unit that answered for this one, one under the other, each with its source's
 * badge, its row, its fuller read as a short list and its own way in ("Visa i Personal"), a link, never an action; the
 * unit's facts in the rail. A source that did not answer says so in its own section with Försök igen. `?section=`
 * scrolls to a section and gives its heading the focus, as on a person's page. A unit the reader may not ask about is
 * the page's own "finns inte" (the server answers 404 for both). No rail entry leads here (an administrator places the
 * rail's tools): Läget on Hem, the person's page and any row that names the unit do, and `from` names the page it was
 * opened from for the way back.
 *
 * The page holds the panel beside its column (D111 rules 2 to 4, `usePagePanel`): a work item under Behöver dig and the
 * one an action makes open there, with the way back kept in the address, and closing leaves the page as it was. While
 * the panel holds something beside the page the details are behind "Visa detaljer"; in a narrower window the panel is
 * the drawer over the page.
 */
export function UnitPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { id = '' } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const section = search.get('section') || undefined;
  const read = useQuery(entityDetailQuery('unit', id));
  const detail: EntityDetail | undefined = read.data;
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  // Every source's answer for the unit, each its own read, a silent one said aloud once, as on the opened person.
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? [], 'unit');
  const staff = useStaffCount(user, id);
  const menu = useQuery(areasQuery).data?.menu;
  const origin = originOf(from, menu);
  const tool = toolOf(from);
  // The rail marks the place the unit was opened from; nothing in it is the unit's own.
  const current: RailCurrent = from?.startsWith('/staff')
    ? { surface: 'staff' }
    : tool
      ? { surface: 'verktyg', view: tool }
      : from === '/' || from?.startsWith('/?')
        ? { surface: 'start' }
        : { surface: 'verktyg', view: null };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });
  usePageTitle(detail ? detail.entity.name : missing ? 'Enheten finns inte' : null);
  // A decision made on a work item beside the page changes what Behöver dig holds: the unit is read again, its sources not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.detail('unit', id), exact: true });
  }, [client, id]);
  // "Fråga Clew" (D112 item 7): the unit on the page is the thing the panel is about. A source's read about a unit never
  // reaches the model (D97 item 7): the question goes without a chip, and the conversation is drawn beside the unit.
  const pageThing: OwnThing | null = detail
    ? {
        id: `page:unit:${id}`,
        title: detail.entity.name,
        subtitle: 'Enheten på sidan',
        subject: { key: `unit:${id}`, label: 'enheten', chips: [], search: '' },
      }
    : null;
  const panel = usePagePanel({ overlayOnly: short, onChange: cardChanged, pageThing });
  const hold = panel.ref !== null || search.has('talk') || search.has('review');
  const headingRef = useAddressedSection(section, id, hold);

  let body: ReactNode;
  if (missing || read.isError || !detail)
    body = (
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={!short}>
            {missing ? (
              <EmptyState
                headingLevel={1}
                title="Enheten finns inte"
                description="Det finns ingen sådan enhet, eller så hör du inte till den. Adressen kan också ha ändrats."
                actions={<Button label="Till startsidan" href="/" />}
              />
            ) : read.isError ? (
              <VStack gap={3}>
                <Text as="p" role="alert">
                  {errorMessage(read.error, 'Uppgifterna kunde inte hämtas just nu.')}
                </Text>
                <HStack>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Försök igen"
                    isLoading={read.isFetching}
                    onClick={() => void read.refetch()}
                  />
                </HStack>
              </VStack>
            ) : (
              <ContentSkeleton />
            )}
          </LayoutContent>
        }
      />
    );
  else {
    const { name } = detail.entity;
    const sections: PageSectionEntry[] = [
      ...(detail.cards.length > 0
        ? [
            {
              key: NEEDS_YOU,
              node: (
                <PageSection title="Behöver dig" headingRef={headingRef(NEEDS_YOU)}>
                  <NeedsYouRows cards={detail.cards} />
                </PageSection>
              ),
            },
          ]
        : []),
      ...drawnSections(answers).map(a => ({
        key: a.source.capability,
        node: (
          <PageSection
            title={a.source.title}
            badge={<SourceBadge source={a.source} />}
            end={<SourceWay source={a.source} entity={detail.entity} />}
            headingRef={headingRef(a.source.capability)}
          >
            <UnitSourceBody answer={a} />
          </PageSection>
        ),
      })),
    ];
    body = (
      <EntityPage
        back={origin}
        title={name}
        subtitle="Enhet"
        actions={
          // On a phone "Åtgärder" is the width of the column, "Fråga Clew" under it.
          mobile ? (
            <VStack gap={2}>
              <EntityActions detail={detail} mobile />
              <HStack>
                <AskClew />
              </HStack>
            </VStack>
          ) : (
            <HStack gap={2} vAlign="start" wrap="wrap">
              <EntityActions detail={detail} mobile={false} />
              <AskClew />
            </HStack>
          )
        }
        sections={sections}
        // A section on its way is drawn, so none at all means every source answered without a row and there is no work item.
        empty={<EmptyState isCompact headingLevel={2} title={`Inget mer att visa om ${name}`} />}
        details={<UnitDetails staff={staff} />}
        label={name}
        panel={panel}
      />
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
      {panel.overlay}
      {/* A source's way in that is a talk lies over the page and its panel, as on a person's page (D111 rule 5). */}
      {user.role === 'manager' && <TalkOverlay back={detail ? `Tillbaka till ${detail.entity.name}` : 'Tillbaka'} />}
    </Shell>
  );
}
