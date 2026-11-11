import { useCallback, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { EntityDetail, EntityList, SessionUser } from '@clew/contracts';
import {
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  EmptyState,
  Grid,
  HStack,
  Layout,
  LayoutContent,
  Link,
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
import { insideClew, originOf, toolOf } from '../person-address';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { PageHeader } from '../components/page-header';
import { ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { TalkOverlay } from '../components/talk-overlay';
import {
  EntityActions,
  NeedsYouSection,
  SectionFrame,
  SourceSection,
  drawnSections,
  useSectionAnswers,
} from '../components/entity-sections';

/** A section keeps this width; two stand side by side where both get it, one under the other below that (1.4.10). */
const SECTION_MIN = 420;
/** The page's column at its widest, less its 32 px padding on each side. */
const COLUMN = 1040 - 2 * 32;

/**
 * Clew's own section (artboard E): how many people the unit has, from the reader's own list of the people on the units
 * they manage, and the way to Personal. Drawn only for a unit the reader manages; while that list is on its way the
 * section keeps its place, and a list that could not be read says so here with the one way to ask again.
 */
function StaffSection({ count, read }: { count: number | undefined; read: UseQueryResult<EntityList, Error> }) {
  return (
    <SectionFrame title="Personal" caption="Clew" headingLevel={2}>
      {read.isPending ? (
        <VStack gap={2}>
          <Skeleton height={36} width="50%" />
          <Skeleton height={20} width="30%" />
        </VStack>
      ) : count === undefined ? (
        <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
          <Text>Antalet medarbetare kunde inte hämtas.</Text>
          <Button
            size="sm"
            variant="secondary"
            label="Försök igen"
            aria-label="Försök igen med Personal"
            isLoading={read.isFetching}
            onClick={() => void read.refetch()}
          />
        </HStack>
      ) : (
        <VStack gap={2}>
          <Text type="display-3" hasTabularNumbers>
            {count} medarbetare
          </Text>
          <HStack>
            <Link href="/staff" weight="semibold" isStandalone>
              Öppna Personal
            </Link>
          </HStack>
        </VStack>
      )}
    </SectionFrame>
  );
}

/**
 * Whether the reader manages the unit and how many people it has: the people the reader may ask about come in one group
 * per unit they manage (`GET /api/entities/person`), so the unit's group says both. A manager whose list could not be
 * read still gets the section, saying so; anyone else gets none.
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

/**
 * The unit as a page (D97 items 5 and 6, artboard E), at `/units/:id`: its name with its actions, what Clew knows of it
 * (a unit, and that the reader is its manager), then one section per source in a grid that is one column on a narrow
 * window: Behöver dig with the reader's cards about the unit, Clew's own Personal for a unit the reader manages, then
 * every source about a unit that answered for this one, each named with its source and drawn by the shared section. A
 * source that did not answer says so in its own section with Försök igen. A unit the reader may not ask about is the
 * page's own "finns inte" (the server answers 404 for both). No rail entry leads here (an administrator places the
 * rail's tools): Läget on Hem, the person's header and any row that names the unit do, and `from` names the page it was
 * opened from for the way back.
 *
 * The page holds the panel beside its column (D107 rules 2 to 4, `usePagePanel`): a card under Behöver dig and the card
 * an action makes open there, with the way back kept in the address, and closing leaves the page as it was. It stands
 * beside the page from the one width every page has (`BESIDE_FROM`), and the sections give way to one across where two
 * no longer fit beside it (the grid's own least width); in a narrower window it is the drawer over the page.
 */
export function UnitPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { id = '' } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
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
  // A decision made on a card beside the page changes what Behöver dig holds: the unit is read again, its sources not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.detail('unit', id), exact: true });
  }, [client, id]);
  const panel = usePagePanel({ overlayOnly: short, onChange: cardChanged });

  let body: ReactNode;
  if (missing)
    body = (
      <EmptyState
        headingLevel={1}
        title="Enheten finns inte"
        description="Det finns ingen sådan enhet, eller så hör du inte till den. Adressen kan också ha ändrats."
        actions={<Button label="Till startsidan" href="/" />}
      />
    );
  else if (read.isError)
    body = (
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
    );
  else if (!detail) body = <ContentSkeleton />;
  else {
    const { name, key, id: unitId } = detail.entity;
    const drawn = drawnSections(answers);
    const settled = answers.every(a => !a.query.isPending) && !staff.read.isPending;
    const nothing = detail.cards.length === 0 && !staff.shown && drawn.length === 0;
    body = (
      <>
        <PageHeader
          title={name}
          end={<EntityActions detail={detail} mobile={mobile} />}
          meta={<Text color="secondary">{staff.manages === true ? 'Enhet · du är chef' : 'Enhet'}</Text>}
        />
        {settled && nothing ? (
          <EmptyState isCompact headingLevel={2} title={`Inget mer att visa om ${name}`} />
        ) : (
          // Two sections across where both get 420 px, one under the other below that (1.4.10); each a named region
          // whose heading is the outline's second level, under the unit's name.
          <Grid columns={{ minWidth: SECTION_MIN, max: 2 }} gap={4}>
            {detail.cards.length > 0 && <NeedsYouSection cards={detail.cards} headingLevel={2} />}
            {staff.shown && <StaffSection count={staff.count} read={staff.read} />}
            {drawn.map(a => (
              <SourceSection key={a.source.capability} answer={a} personKey={key} personId={unitId} headingLevel={2} />
            ))}
          </Grid>
        )}
      </>
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* As on the person's page: the page and the panel beside it scroll on their own, the column is bounded inside the content so the panel docks to the window's edge, and on a short window the page scrolls as one (1.4.10). */}
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                {origin && detail && (
                  <Breadcrumbs label="Du är här" variant="supporting" separator="›">
                    <BreadcrumbItem href={origin.href}>{origin.label}</BreadcrumbItem>
                    <BreadcrumbItem isCurrent>{detail.entity.name}</BreadcrumbItem>
                  </Breadcrumbs>
                )}
                {body}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
      {/* A source's way in that is a talk lies over the page and its panel, as on a person's page (D107 rule 5). */}
      {user.role === 'manager' && <TalkOverlay back={detail ? `Tillbaka till ${detail.entity.name}` : 'Tillbaka'} />}
    </Shell>
  );
}
