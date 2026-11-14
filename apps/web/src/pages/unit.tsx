import { useLayoutEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Area, EntityDetail, EntityList, SessionUser } from '@clew/contracts';
import {
  Badge,
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  EmptyState,
  HStack,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Skeleton,
  TONE_WORDS,
  Table,
  Text,
  VStack,
  VisuallyHidden,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, entityDetailQuery, entityListQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { NEEDS_YOU, insideClew, originOf, overlayRedirect, sourceTab, toolOf, unitPageHref } from '../person-address';
import { TALK_PARAM } from '../talk-address';
import { DIALOGUE_PARAM } from '../dialogue-address';
import { entitySubject } from '../conversation-about';
import { declaredPage, viewPageHref } from '../view-address';
import { toolHref, useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { AskClew } from '../components/thing-panel';
import { DialogueTab } from '../components/dialogue-overlay';
import { EntityPage, PageSection, RailSection, ThingTabs, type PageSectionEntry } from '../components/entity-page';
import {
  EntityActions,
  NeedsYouRows,
  SectionRow,
  SourceBadge,
  SourceWay,
  Unanswered,
  UnitSourceBody,
  drawnSections,
  rowOf,
  unanswered,
  useSectionAnswers,
  type SectionAnswer,
} from '../components/entity-sections';
import { KeyFigureTiles } from '../components/unit-figures';
import { PageFrame } from '../components/page-frame';

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

/**
 * The unit's place among the units the reader follows up (D117), as Astryx's breadcrumb with a menu on a crumb:
 * Läget's register of the units first (`/units`), for a unit below the reader the way up to their own unit it reports to, and the current
 * unit as a menu of every other unit
 * they follow up, in the groups the list of units gives ("Mina enheter", "Enheter under dig"), each a real link. Nothing
 * for a reader who follows up one unit alone, or while the list is on its way.
 */
function unitTrail(detail: EntityDetail, list: EntityList | undefined): ReactNode {
  const others = (list?.groups ?? []).flatMap(g => {
    const items = g.entities
      .filter(e => e.key !== detail.entity.key)
      .map(e => ({ id: e.key, label: e.name, href: unitPageHref(e.key) }));
    return items.length ? [{ type: 'section' as const, id: g.id, title: g.label, items }] : [];
  });
  if (!others.length && !detail.above) return null;
  return (
    <Breadcrumbs label="Enheter" variant="supporting">
      <BreadcrumbItem href="/units">Läget</BreadcrumbItem>
      {detail.above && <BreadcrumbItem href={unitPageHref(detail.above.key)}>{detail.above.name}</BreadcrumbItem>}
      <BreadcrumbItem isCurrent {...(others.length ? { menu: others } : {})}>
        {detail.entity.name}
      </BreadcrumbItem>
    </Breadcrumbs>
  );
}

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
 * page has: that it is a unit, the reader's role on it, for a unit the reader manages how many people it has, with the
 * way to Personal as a link, and the units under it whose managers report to the reader (D117), each a link to its
 * page with this one as the way back. A unit below the reader says so as the role. The unit above is not drawn.
 */
function UnitDetails({ staff, detail, here }: { staff: StaffCount; detail: EntityDetail; here: string }) {
  const below = detail.below ?? [];
  return (
    <RailSection title="Detaljer" caption="Katalogen">
      <VStack gap={4}>
        <MetadataList>
          <MetadataListItem label="Typ">
            <Text>Enhet</Text>
          </MetadataListItem>
          {detail.relation === 'below' ? (
            <MetadataListItem label="Din roll">
              <Text>Enhetens chef rapporterar till dig</Text>
            </MetadataListItem>
          ) : (
            staff.manages !== null && (
              <MetadataListItem label="Din roll">
                <Text>{staff.manages ? 'Chef' : 'Medarbetare'}</Text>
              </MetadataListItem>
            )
          )}
          {below.length > 0 && (
            <MetadataListItem label="Enheter under">
              <VStack gap={1}>
                {below.map(unit => (
                  <Link key={unit.key} href={unitPageHref(unit.key, { from: here })}>
                    {unit.name}
                  </Link>
                ))}
              </VStack>
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

/** The tab the page opens on, which has no `section` in the address. */
const OVERVIEW = 'overview';

/** Where a figure leads (D126 rule 1): the tool's page when its view is a tool in the person's menu, else its own page. */
function useFigureHref(from: string) {
  const areas = useQuery(areasQuery).data;
  return (area: Area): string | null => {
    const opens = area.figure?.opens;
    if (!opens) return null;
    if (areas?.menu?.some(e => e.capability === opens.capability)) return toolHref(opens.capability);
    return (
      declaredPage(areas?.views, opens.capability) ??
      viewPageHref({ capability: opens.capability, title: opens.title }, from)
    );
  };
}

/** A figure's status in Clew's words (D54): Lugnt, Bevaka or Behöver dig; a source that did not answer says so. */
function FigureStatus({ area }: { area: Area }) {
  const figure = area.figure!;
  if (figure.unavailable) return <Badge variant="warning" label="Svarar inte" />;
  if (figure.tone === 'none') return <Text color="secondary">–</Text>;
  const tone = TONE_WORDS[figure.tone];
  return <Badge variant={tone.variant} label={tone.word} />;
}
/** A figure's value as Hem's tile says it; a figure without one is its label's sentence alone. */
const figureValue = (area: Area) => area.figure?.value ?? null;
/** The figure's name, a link to its page where it opens one. */
function FigureName({ area, href }: { area: Area; href: string | null }) {
  const label = area.figure!.label;
  return href ? (
    <Link href={href} color="primary" weight="semibold">
      {label}
    </Link>
  ) : (
    <Text weight="semibold">{label}</Text>
  );
}
interface FigureRow extends Record<string, unknown> {
  id: string;
  area: Area;
}
/**
 * Läget on the unit's page (D54, D117; D126: Hem shows at most four figures, the unit's page every one): each figure of
 * the reader's own unit, the calm, the empty and the silent ones included, with its label (a link to the figure's page
 * where it opens one), its value, its status in Clew's words and its note, in the areas' own order. A `Table` where
 * there is room, the same facts as a list on a phone (1.4.10). Nothing while there is no figure.
 */
function UnitFigures({ from }: { from: string }) {
  const mobile = useMediaQuery(mobileQuery);
  const areasQ = useQuery(areasQuery);
  const href = useFigureHref(from);
  const figures = (areasQ.data?.areas ?? []).filter(a => a.figure);
  if (areasQ.isPending) return <ContentSkeleton label="Hämtar läget …" rows={3} heading={false} />;
  if (!figures.length) return null;
  return (
    <PageSection title="Läget">
      {mobile ? (
        <List hasDividers edge="flush" aria-label="Läget">
          {figures.map(a => (
            <ListItem
              key={a.connector + ':' + a.id}
              label={<FigureName area={a} href={href(a)} />}
              description={
                <Text type="supporting">
                  {[figureValue(a), a.figure!.comparison].filter(Boolean).join('\u00a0· ') || 'Inget värde'}
                </Text>
              }
              endContent={<FigureStatus area={a} />}
            />
          ))}
        </List>
      ) : (
        <Table<FigureRow>
          data={figures.map(area => ({ id: area.connector + ':' + area.id, area }))}
          idKey="id"
          columns={[
            {
              key: 'label',
              header: 'Mått',
              width: proportional(2, { minWidth: 200 }),
              renderCell: r => <FigureName area={r.area} href={href(r.area)} />,
            },
            {
              key: 'value',
              header: 'Värde',
              width: pixel(140),
              align: 'end',
              renderCell: r =>
                figureValue(r.area) ? (
                  <Text hasTabularNumbers>{figureValue(r.area)}</Text>
                ) : (
                  <Text color="secondary">Inget värde</Text>
                ),
            },
            { key: 'status', header: 'Status', width: pixel(140), renderCell: r => <FigureStatus area={r.area} /> },
            {
              key: 'note',
              header: 'Kommentar',
              width: proportional(2, { minWidth: 180 }),
              renderCell: r => <Text color="secondary">{r.area.figure!.comparison ?? ''}</Text>,
            },
          ]}
          density="balanced"
        />
      )}
    </PageSection>
  );
}

/** A source's section on the overview: its heading, its system, its row in short, and the link to its own tab. */
function OverviewSection({ answer, href }: { answer: SectionAnswer; href: string }) {
  const row = rowOf(answer);
  return (
    <PageSection
      title={answer.source.title}
      badge={<SourceBadge source={answer.source} />}
      end={
        <Link href={href} isStandalone>
          Visa allt
          <VisuallyHidden>{` om ${answer.source.title.toLocaleLowerCase('sv-SE')}`}</VisuallyHidden>
        </Link>
      }
    >
      {answer.query.isPending ? (
        <ContentSkeleton rows={2} heading={false} />
      ) : unanswered(answer) || !row ? (
        <Unanswered answer={answer} />
      ) : (
        <SectionRow source={answer.source} row={row} />
      )}
    </PageSection>
  );
}

/**
 * The unit as a page (D126 rule 1, the composition of board Person; D97 items 5 and 6), at `/units/:id`, "Läget" in the
 * rail for a manager who follows up one unit: the way back and the unit's place among the units the reader follows up,
 * its name, its actions and "Fråga Clew" under the name, then its tabs, each a link with its own address (`?section=`):
 * Översikt (Läget, every figure of the reader's own unit; the sources' key figures; Behöver dig; each source's row in
 * short with "Visa allt"), one tab per source that answered for this unit (its row and its fuller read; the follow-up
 * dialogue's tab is the dialogue itself, D118, D126 rule 3) and Ärenden (the reader's work items about the unit). The
 * unit's facts are the end panel. A source that did not answer says so in its own place with Försök igen. A unit the
 * reader may not ask about is the page's own "finns inte" (the server answers 404 for both).
 *
 * Old addresses keep working (rule 3): `?dialog=<unitId>`, the drawer that lay over the page, is the dialogue's tab,
 * and `?talk=<personId>` the person's talk tab, each replaced in the history.
 */
export function UnitPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { id = '' } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const section = search.get('section') || OVERVIEW;
  const read = useQuery(entityDetailQuery('unit', id));
  const detail: EntityDetail | undefined = read.data;
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  // Every source's answer for the unit, each its own read, a silent one said aloud once, as on the opened person.
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? [], 'unit');
  const staff = useStaffCount(user, id);
  // The units the reader follows up, for the trail's menu (D117); a manager's only, since an employee has one.
  const units = useQuery({ ...entityListQuery('unit'), enabled: user.role === 'manager' });
  const menu = useQuery(areasQuery).data?.menu;
  const origin = originOf(from, menu);
  const tool = toolOf(from);

  // The drawers that lay over the page before D126 (`?dialog=`, `?talk=`) are tabs of a page now.
  const dialogueSource = detail?.sections.find(s => sourceTab(s.page) === 'dialogue');
  const moved =
    search.has(TALK_PARAM) || (detail && search.has(DIALOGUE_PARAM))
      ? overlayRedirect(pathname, search, { dialogue: dialogueSource?.capability })
      : null;
  useLayoutEffect(() => {
    if (moved) navigate(moved, { replace: true });
  }, [moved]);

  // The rail marks the place the unit was opened from; otherwise a manager's unit is Läget's, and an employee's marks
  // nothing.
  const current: RailCurrent = from?.startsWith('/staff')
    ? { surface: 'staff' }
    : tool
      ? { surface: 'verktyg', view: tool }
      : from === '/' || from?.startsWith('/?')
        ? { surface: 'start' }
        : user.role === 'manager'
          ? { surface: 'units' }
          : { surface: 'verktyg', view: null };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });

  const drawn = drawnSections(answers);
  const tabs: Array<{ value: string; label: string; badge?: ReactNode }> = detail
    ? [
        { value: OVERVIEW, label: 'Översikt' },
        ...drawn.map(a => ({ value: a.source.capability, label: a.source.title })),
        ...(detail.cards.length > 0
          ? [
              {
                value: NEEDS_YOU,
                label: 'Ärenden',
                badge: (
                  <HStack gap={0} vAlign="center">
                    <Badge variant="error" label={String(detail.cards.length)} />
                    <VisuallyHidden> behöver dig</VisuallyHidden>
                  </HStack>
                ),
              },
            ]
          : []),
      ]
    : [];
  const pendingTab = answers.some(a => a.source.capability === section && a.query.isPending);
  const tab = tabs.some(t => t.value === section) || pendingTab ? section : OVERVIEW;
  const tabName = tabs.find(t => t.value === tab)?.label;
  usePageTitle(
    detail
      ? tab === OVERVIEW || !tabName
        ? detail.entity.name
        : `${tabName} · ${detail.entity.name}`
      : missing
        ? 'Enheten finns inte'
        : null,
  );
  const tabHref = (value: string) => unitPageHref(id, { ...(value === OVERVIEW ? {} : { section: value }), from });
  const here = tabHref(OVERVIEW);

  let body: ReactNode;
  if (missing || read.isError || !detail)
    body = (
      <PageFrame>
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
      </PageFrame>
    );
  else {
    const { name } = detail.entity;
    // "Fråga Clew" (D126 rule 5): a new conversation about the unit, the same subject from every tab; the tab it was
    // pressed on is only what the pane beside the transcript shows first. A source's read about a unit never reaches
    // the model (D97 item 7): the question goes without a chip.
    const shownFirst = drawn.some(a => a.source.capability === tab) || tab === NEEDS_YOU ? tab : null;
    const ask = <AskClew subject={entitySubject('unit', id, shownFirst)} />;
    const answer = drawn.find(a => a.source.capability === tab);
    let sections: PageSectionEntry[];
    if (tab === NEEDS_YOU)
      sections = [
        {
          key: NEEDS_YOU,
          node: (
            <PageSection title="Ärenden">
              <NeedsYouRows cards={detail.cards} />
            </PageSection>
          ),
        },
      ];
    else if (answer)
      sections = [
        {
          key: answer.source.capability,
          node: (
            <PageSection
              title={answer.source.title}
              badge={<SourceBadge source={answer.source} />}
              end={
                sourceTab(answer.source.page) ? undefined : (
                  <SourceWay source={answer.source} entity={{ ...detail.entity, kind: 'unit' }} />
                )
              }
            >
              {sourceTab(answer.source.page) === 'dialogue' ? (
                <DialogueTab unitId={detail.entity.key} />
              ) : (
                <UnitSourceBody answer={answer} />
              )}
            </PageSection>
          ),
        },
      ];
    else {
      // The unit's key figures from its sources (D117), each source's value large with its state, after Läget.
      const tiles = <KeyFigureTiles answers={answers} />;
      sections = [
        // Läget is the reader's own unit's: the areas' figures are the session's (D54).
        ...(id === user.unitId ? [{ key: 'laget', node: <UnitFigures from={here} /> }] : []),
        ...(answers.some(a => !!rowOf(a)) ? [{ key: 'key-figures', node: tiles }] : []),
        ...(detail.cards.length > 0
          ? [
              {
                key: NEEDS_YOU,
                node: (
                  <PageSection
                    title="Behöver dig"
                    end={
                      <Link href={tabHref(NEEDS_YOU)} isStandalone>
                        Visa allt
                        <VisuallyHidden> om ärenden</VisuallyHidden>
                      </Link>
                    }
                  >
                    <NeedsYouRows cards={detail.cards} />
                  </PageSection>
                ),
              },
            ]
          : []),
        ...drawn.map(a => ({
          key: a.source.capability,
          node: <OverviewSection answer={a} href={tabHref(a.source.capability)} />,
        })),
      ];
    }
    body = (
      <EntityPage
        // The trail leads back to Läget's register itself, so a unit opened from it needs no way back of its own.
        back={from?.split('?')[0] === '/units' ? null : origin}
        crumbs={unitTrail(detail, units.data)}
        title={name}
        subtitle="Enhet"
        actions={<EntityActions detail={detail} mobile={mobile} ask={ask} />}
        tabs={
          <ThingTabs
            label={`Om ${name}`}
            value={tab}
            tabs={tabs.map(t => ({
              ...t,
              href: tabHref(t.value),
              ...(t.value === NEEDS_YOU ? { count: detail.cards.length } : {}),
            }))}
          />
        }
        sections={sections}
        // A section on its way is drawn, so none at all means every source answered without a row and there is no work item.
        empty={<EmptyState isCompact headingLevel={2} title={`Inget mer att visa om ${name}`} />}
        details={<UnitDetails staff={staff} detail={detail} here={here} />}
        label={tabName && tab !== OVERVIEW ? `${tabName}, ${name}` : name}
      />
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
    </Shell>
  );
}
