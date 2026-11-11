import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityDetail, SessionUser } from '@clew/contracts';
import {
  Avatar,
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Icon,
  Layout,
  LayoutContent,
  Link,
  Skeleton,
  StackItem,
  Text,
  Timestamp,
  Toolbar,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, entityDetailQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
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
  SectionNav,
  SectionRow,
  Unanswered,
  drawnSections,
  openOf,
  rowOf,
  sectionNavRows,
  sourceCaption,
  unanswered,
  useSectionAnswers,
  type SectionAnswer,
} from '../components/entity-sections';

/** The `settings-sidebar` template's breakpoint: below it the list of sections and the chosen one are two steps. */
const narrowQuery = '(max-width: 768px)';
/** The fuller view's table needs the page beside the list of sections: a 1280 px window, the rail beside the page. */
const TABLE_QUERY = '(min-width: 1280px)';
/** With the panel beside the page the table needs the same column, so a window wider by the panel. */
const TABLE_BESIDE_QUERY = panelBesideQuery(1280 - RAIL);
/** The list of sections keeps its width (artboard C2); the chosen section beside it reads down to this. */
const SECTIONS_WIDTH = 340;
const CHOSEN_MIN = 300;
/** The page's column at its widest, less its 32 px padding on each side, and the least the two side by side need. */
const COLUMN = 1216 - 2 * 32;
const PERSON_MIN = SECTIONS_WIDTH + 32 + CHOSEN_MIN + 2 * 32;
/** Where the list of sections and the chosen one still stand side by side with the panel open beside the page. */
const SIDE_BY_SIDE_BESIDE_QUERY = panelBesideQuery(PERSON_MIN);

/**
 * The chosen source's fuller view (artboard C2): its name, where it was read and when, the way to its own page, then its
 * read in full. It shows only what was read: an action about the person is drawn once, beside their name, whichever
 * section is open (D97, amended 2026-11-11), so its refusal stands there too.
 */
function ChosenSection({
  detail,
  answer,
  level,
  tableQuery,
}: {
  detail: EntityDetail;
  answer: SectionAnswer;
  level: 'page' | 'drill';
  tableQuery: string;
}) {
  const { key, id } = detail.entity;
  const row = rowOf(answer);
  // The source's own page in Clew: the person's talk lies over this page, with the section and the way back kept.
  const { pathname, search } = useLocation();
  const page = answer.source.page ? sourcePageHref(answer.source.page, { key, id }, { pathname, search }) : null;
  const read = answer.query.dataUpdatedAt;
  return (
    <VStack gap={5}>
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <VStack gap={0}>
          {level === 'page' && <Heading level={2}>{answer.source.title}</Heading>}
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
        {page && answer.source.page && (
          <Link href={page} weight="semibold" isStandalone>
            {answer.source.page.title}
          </Link>
        )}
      </HStack>
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
function ChosenCards({ detail, level }: { detail: EntityDetail; level: 'page' | 'drill' }) {
  return (
    <VStack gap={5}>
      <VStack gap={0}>
        {level === 'page' && <Heading level={2}>Behöver dig</Heading>}
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
 * reached from a name on Personal or on any row that names them: the trail back to the list, the person's name with
 * their actions (the one place they are drawn, whichever section is open), the list of sections ("Om <namn>", each with
 * its source and one line) and beside it the chosen source's fuller view, `?section=` in the address. On a narrow window the two are the `settings-sidebar` template's
 * drill-in: the list, then the chosen section with the way back to the list. A person the reader may not ask about is
 * the page's own "finns inte" (the server answers 404 for both).
 *
 * The page holds the panel beside its column (D110 rules 2 to 4, `usePagePanel`): a card under Behöver dig and the card
 * an action makes open there, with the section and the way back kept in the address, and closing leaves the page as it
 * was. Choosing another section keeps what is open beside it. The panel stands beside the page from the one width
 * every page has (`BESIDE_FROM`); the page gives way, not the panel: where the list of sections and the chosen one no
 * longer fit side by side beside it, the page is its narrow drill-in, and the fuller view's table its list. In a
 * narrower window the panel is the drawer over the page.
 */
export function PersonPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { key = '' } = useParams<{ key: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const narrowWindow = useMediaQuery(narrowQuery);
  const sideBySideBeside = useMediaQuery(SIDE_BY_SIDE_BESIDE_QUERY);
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
  // The page gives way to the panel beside it (the product owner, 2026-11-11): the narrow drill-in it draws on a narrow
  // window, wherever the two no longer fit side by side beside the panel.
  const narrow = narrowWindow || (panel.occupied && !sideBySideBeside);
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
  const fallback = detail ? (detail.cards.length > 0 ? NEEDS_YOU : drawn[0]?.source.capability) : undefined;
  const chosenId = section ?? (narrow ? undefined : fallback);
  const chosen = chosenId ? answers.find(a => a.source.capability === chosenId) : undefined;
  const showsCards = chosenId === NEEDS_YOU && !!detail && detail.cards.length > 0;
  // Another section is a move within the page: what is open beside it stays.
  const hrefFor = (id: string | null) =>
    keepingPanel(personPageHref(key, { ...(id ? { section: id } : {}), from }), search);
  // Into a section on a narrow window the focus goes to the way back; out of it, to the row it came from.
  const backLink = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const lastSection = useRef(section);
  useEffect(() => {
    const was = lastSection.current;
    lastSection.current = section;
    if (!narrow || was === section) return;
    if (section) backLink.current?.focus();
    else if (was) navRef.current?.querySelector<HTMLElement>(`a[href="${CSS.escape(hrefFor(was))}"]`)?.focus();
  }, [section, narrow]);

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
    const list = (
      <VStack ref={navRef} as="nav" aria-label={`Om ${name}`}>
        <Card padding={0} {...(narrow ? {} : { width: SECTIONS_WIDTH })}>
          <SectionNav rows={sectionNavRows(detail.cards, answers, hrefFor, narrow ? undefined : chosenId)} />
        </Card>
      </VStack>
    );
    const view = showsCards ? (
      <ChosenCards detail={detail} level={narrow ? 'drill' : 'page'} />
    ) : chosen ? (
      <ChosenSection
        detail={detail}
        answer={chosen}
        level={narrow ? 'drill' : 'page'}
        tableQuery={panel.occupied ? TABLE_BESIDE_QUERY : TABLE_QUERY}
      />
    ) : null;
    const chosenTitle = showsCards ? 'Behöver dig' : chosen?.source.title;
    body = (
      <>
        <PageHeader
          title={name}
          icon={<Avatar name={name} size={60} tooltip={false} aria-hidden />}
          end={<EntityActions detail={detail} mobile={mobile} />}
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
        {detail.cards.length === 0 && drawn.length === 0 && answers.every(a => !a.query.isPending) ? (
          <EmptyState isCompact headingLevel={2} title={`Inget mer att visa om ${name}`} />
        ) : narrow ? (
          view && chosenTitle ? (
            <VStack gap={4}>
              <Toolbar
                label={`Tillbaka till Om ${name}`}
                gap={2}
                startContent={
                  <>
                    <Button
                      ref={backLink}
                      label={`Tillbaka till Om ${name}`}
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon="chevronLeft" size="sm" />}
                      href={hrefFor(null)}
                    />
                    <Heading level={2}>{chosenTitle}</Heading>
                  </>
                }
              />
              {view}
            </VStack>
          ) : (
            list
          )
        ) : (
          // The list of sections and the chosen one side by side (the template's sidebar and content, artboard C2):
          // the list keeps its width, the view takes the rest.
          <HStack gap={8} vAlign="start">
            <StackItem>{list}</StackItem>
            <StackItem size="fill">{view}</StackItem>
          </HStack>
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
