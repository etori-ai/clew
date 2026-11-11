import { useCallback, type ReactNode } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityAction, EntityDetail, SessionUser } from '@clew/contracts';
import {
  Avatar,
  Badge,
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  Link,
  Skeleton,
  Tab,
  TabList,
  Text,
  Timestamp,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, entityDetailQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useEntityAction } from '../entity-actions';
import { keepingPanel } from '../panel-address';
import { insideClew, originOf, personPageHref, toolOf } from '../person-address';
import { sourcePageHref } from '../talk-address';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { PageHeader } from '../components/page-header';
import { ContentSkeleton } from '../components/loading';
import { RAIL, panelBesideQuery } from '../components/panel';
import { usePagePanel } from '../components/page-panel';
import { TalkOverlay } from '../components/talk-overlay';
import {
  CardList,
  EntityActions,
  NEEDS_YOU,
  OpenRead,
  PersonLine,
  SectionRow,
  Unanswered,
  drawnSections,
  openOf,
  rowOf,
  sectionActions,
  sectionlessActions,
  sourceCaption,
  unanswered,
  useSectionAnswers,
  type SectionAnswer,
} from '../components/entity-sections';

/** The fuller view's table needs a 1280 px window with the rail beside the page, as on a tool's page. */
const TABLE_QUERY = '(min-width: 1280px)';
/** With the panel beside the page the table needs the same column, so a window wider by the panel. */
const TABLE_BESIDE_QUERY = panelBesideQuery(1280 - RAIL);
/** The page's column at its widest, less its 32 px padding on each side. */
const COLUMN = 1216 - 2 * 32;

/**
 * The person's sections as a tab strip under the name (D97, amended 2026-11-11; the product owner's choice): Behöver dig
 * with the count of the reader's cards in a badge, as Hem's tabs count, when there are any, then each drawn source by
 * its section's title. Each tab is a link to the page with that section chosen (`?section=`), so the strip is Astryx's
 * navigation pattern, a landmark named "Om <namn>" with the chosen tab current, and back, forward and an address choose
 * as a click does. One tab stop, the arrows between the tabs; a strip wider than the column scrolls and keeps the chosen
 * tab in view.
 */
function SectionTabs({
  name,
  cards,
  drawn,
  chosen,
  hrefFor,
}: {
  name: string;
  cards: EntityDetail['cards'];
  drawn: SectionAnswer[];
  chosen: string | undefined;
  hrefFor: (id: string) => string;
}) {
  return (
    // The tab is a link: the address chooses the section, so choosing needs nothing more here.
    <TabList value={chosen ?? ''} onChange={() => {}} aria-label={`Om ${name}`} hasDivider>
      {cards.length > 0 && (
        <Tab
          value={NEEDS_YOU}
          label="Behöver dig"
          href={hrefFor(NEEDS_YOU)}
          endContent={<Badge variant="neutral" label={String(cards.length)} />}
        />
      )}
      {drawn.map(a => (
        <Tab
          key={a.source.capability}
          value={a.source.capability}
          label={a.source.title}
          href={hrefFor(a.source.capability)}
        />
      ))}
    </TabList>
  );
}

/**
 * The chosen source's fuller view (artboard C2) under the tab strip, the column's full width: its name, where it was
 * read and when, its actions and the way to its own page, then its read in full. An action about the person is drawn
 * once, here in its source's section (D97, amended 2026-11-11): beside the heading as a button, on a phone a button the
 * width of the column under it, and the source's refusal stands under them.
 */
function ChosenSection({
  detail,
  answer,
  tableQuery,
  mobile,
}: {
  detail: EntityDetail;
  answer: SectionAnswer;
  tableQuery: string;
  mobile: boolean;
}) {
  const { start, error } = useEntityAction();
  const { kind, key, name, id } = detail.entity;
  const row = rowOf(answer);
  const own = sectionActions(detail.actions, answer);
  const run = (a: EntityAction) => start(a, { kind, key, name });
  // The source's own page in Clew: the person's talk lies over this page, with the section and the way back kept.
  const { pathname, search } = useLocation();
  const page = answer.source.page ? sourcePageHref(answer.source.page, { key, id }, { pathname, search }) : null;
  const read = answer.query.dataUpdatedAt;
  const beside = mobile ? [] : own;
  return (
    <VStack gap={5}>
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <VStack gap={0}>
          <Heading level={2}>{answer.source.title}</Heading>
          <Text type="supporting">
            {sourceCaption(answer.source)}
            {row && read ? (
              <>
                {' · hämtat '}
                <Timestamp value={new Date(read).toISOString()} format="relative" isLive />
              </>
            ) : null}
          </Text>
        </VStack>
        {(beside.length > 0 || (page && answer.source.page)) && (
          <HStack gap={2} wrap="wrap" vAlign="center">
            {beside.map(a => (
              <Button key={a.capability} variant="secondary" label={a.title} onClick={() => run(a)} />
            ))}
            {page && answer.source.page && (
              <Link href={page} weight="semibold" isStandalone>
                {answer.source.page.title}
              </Link>
            )}
          </HStack>
        )}
      </HStack>
      {mobile && own.length > 0 && (
        <VStack gap={2}>
          {own.map(a => (
            <Button key={a.capability} variant="secondary" label={a.title} width="100%" onClick={() => run(a)} />
          ))}
        </VStack>
      )}
      {/* A source's refusal of an action started here, said aloud as it came (entity-actions.ts); it is placed after the
          buttons, so the one that was pressed keeps the focus when it appears. */}
      {error && <Text as="p">{error}</Text>}
      {answer.query.isPending ? (
        <Card>
          <VStack gap={2}>
            <Skeleton height={20} width="60%" />
            <Skeleton height={20} width="40%" />
          </VStack>
        </Card>
      ) : unanswered(answer) || !row ? (
        <Card>
          <Unanswered answer={answer} />
        </Card>
      ) : (
        <>
          <Card>
            <SectionRow source={answer.source} row={row} />
          </Card>
          {openOf(answer.source, row) && <OpenRead source={answer.source} row={row} tableQuery={tableQuery} />}
        </>
      )}
    </VStack>
  );
}

/** Behöver dig as the chosen section: the reader's cards about the person, each opening in the panel beside the page. */
function ChosenCards({ detail }: { detail: EntityDetail }) {
  return (
    <VStack gap={5}>
      <VStack gap={0}>
        <Heading level={2}>Behöver dig</Heading>
        <Text type="supporting">Clew</Text>
      </VStack>
      <Card>
        <CardList cards={detail.cards} />
      </Card>
    </VStack>
  );
}

/**
 * The person as a page (D97 item 5, artboard C2), at `/people/:key`, the one way a person is shown (D110 rule 3),
 * reached from a name on Personal or on any row that names them: the trail back to the list, the person's name, the tab
 * strip of their sections ("Om <namn>") and under it the chosen section at the column's full width, `?section=` in the
 * address; without one the first tab is chosen. The page is the same at every width, a phone included. An action whose
 * source has no section to hold it stands beside the name instead, so each is drawn once and none is lost (D97, amended
 * 2026-11-11). A person the reader may not ask about is the page's own "finns inte" (the server answers 404 for both).
 *
 * The page holds the panel beside its column (D110 rules 2 to 4, `usePagePanel`): a card under Behöver dig and the card
 * an action makes open there, with the section and the way back kept in the address, and closing leaves the page as it
 * was. Choosing another section keeps what is open beside it. The panel stands beside the page from the one width
 * every page has (`BESIDE_FROM`), and the fuller view's table gives way to its list where the column is too narrow
 * beside it; in a narrower window the panel is the drawer over the page.
 */
export function PersonPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { key = '' } = useParams<{ key: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const section = search.get('section') || undefined;
  const read = useQuery(entityDetailQuery('person', key));
  const detail = read.data;
  // A decision made on a card beside the page changes what Behöver dig holds: the person is read again, their sources not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.detail('person', key), exact: true });
  }, [client, key]);
  const panel = usePagePanel({ overlayOnly: short, onChange: cardChanged });
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? []);
  const origin = originOf(from, useQuery(areasQuery).data?.menu);
  const tool = toolOf(from);
  // The rail marks the place the person was opened from; without one, Personal for the reader's own people.
  const current: RailCurrent = from?.startsWith('/staff')
    ? { surface: 'staff' }
    : tool
      ? { surface: 'verktyg', view: tool }
      : from === '/' || from?.startsWith('/?')
        ? { surface: 'start' }
        : !from && detail?.relation === 'managed'
          ? { surface: 'staff' }
          : { surface: 'verktyg', view: null };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });
  usePageTitle(detail ? detail.entity.name : missing ? 'Personen finns inte' : null);
  // The trail (artboard C2): the place the person was opened from, by its name ("Personal", "Hem", a tool's row), and
  // none for an address without one (D83 rule 4: no prior page is guessed).
  const back = detail ? origin : null;
  const drawn = drawnSections(answers);
  // The tabs, in their order: Behöver dig when the reader has cards about the person, then each drawn source. The
  // address chooses one of them; without one, or naming none of them, the first is chosen.
  const tabs = [...(detail && detail.cards.length > 0 ? [NEEDS_YOU] : []), ...drawn.map(a => a.source.capability)];
  const chosenId = section && tabs.includes(section) ? section : tabs[0];
  const chosen = chosenId ? drawn.find(a => a.source.capability === chosenId) : undefined;
  const showsCards = chosenId === NEEDS_YOU;
  // Another section is a move within the page: what is open beside it stays.
  const hrefFor = (id: string) => keepingPanel(personPageHref(key, { section: id, from }), search);

  let body: ReactNode;
  if (missing)
    body = (
      <EmptyState
        headingLevel={1}
        title="Personen finns inte"
        description="Det finns ingen sådan person, eller så har du inte tillgång till uppgifterna om hen. Adressen kan också ha ändrats."
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
    const { name } = detail.entity;
    const view = showsCards ? (
      <ChosenCards detail={detail} />
    ) : chosen ? (
      // Keyed by its source, so a refusal stands only in the section whose action it answered.
      <ChosenSection
        key={chosen.source.capability}
        detail={detail}
        answer={chosen}
        tableQuery={panel.occupied ? TABLE_BESIDE_QUERY : TABLE_QUERY}
        mobile={mobile}
      />
    ) : null;
    body = (
      <>
        <PageHeader
          title={name}
          icon={<Avatar name={name} size={60} tooltip={false} aria-hidden />}
          end={<EntityActions detail={detail} actions={sectionlessActions(detail.actions, answers)} mobile={mobile} />}
          {...(detail.entity.detail || detail.entity.unit
            ? {
                meta: (
                  <Text color="secondary">
                    <PersonLine
                      entity={detail.entity}
                      relation={detail.relation}
                      from={personPageHref(key, { from })}
                    />
                  </Text>
                ),
              }
            : {})}
        />
        {/* A section on its way has its tab, so no tab means every source answered without a row and there are no cards. */}
        {tabs.length === 0 ? (
          <EmptyState isCompact headingLevel={2} title={`Inget mer att visa om ${name}`} />
        ) : (
          <>
            <SectionTabs name={name} cards={detail.cards} drawn={drawn} chosen={chosenId} hrefFor={hrefFor} />
            {view}
          </>
        )}
      </>
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* As on Personal: the layout fills the window, so the page and the panel beside it scroll on their own and the handle's divider stands the height of the page; on a short window nothing is pinned and the page scrolls as one (1.4.10). The column is bounded inside the content, not with the Layout's `contentWidth`, which would frame the panel with it and stand it in from the window's edge. */}
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                {back && (
                  <Breadcrumbs label="Du är här" variant="supporting" separator="›">
                    <BreadcrumbItem href={back.href}>{back.label}</BreadcrumbItem>
                    <BreadcrumbItem isCurrent>{detail!.entity.name}</BreadcrumbItem>
                  </Breadcrumbs>
                )}
                {body}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
      {/* The talk from the talks section's "Öppna samtalet" lies over the page and its panel (D110 rule 5). */}
      {user.role === 'manager' && <TalkOverlay back={detail ? `Tillbaka till ${detail.entity.name}` : 'Tillbaka'} />}
    </Shell>
  );
}
