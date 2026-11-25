import { useLayoutEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { EntityDetail, SessionUser } from '@clew/contracts';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  HStack,
  Heading,
  Link,
  MetadataList,
  MetadataListItem,
  ProgressBar,
  Text,
  Timestamp,
  VStack,
  VisuallyHidden,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../api';
import { adminQueries, areasQuery, boardingPlansQuery, entityDetailQuery } from '../queries';
import { useHeldCapabilities } from '../capabilities';
import { statusLabel, statusOf } from '../user-status';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import {
  NEEDS_YOU,
  OWN_COMPETENCE,
  OWN_PLAN,
  insideClew,
  originOf,
  overlayRedirect,
  personPageHref,
  sourceTab,
  toolOf,
  unitPageHref,
} from '../person-address';
import { TALK_PARAM } from '../talk-address';
import { useNav, type NavCurrent } from '../components/shell/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell/shell';
import { ContentSkeleton } from '../components/shell/loading';
import { TalkTab } from '../components/people/talk-overlay';
import { RegisterHolding } from '../components/people/register-holding';
import {
  EntityPage,
  PageSection,
  RailSection,
  ThingTabs,
  type PageSectionEntry,
} from '../components/people/entity-page';
import {
  EntityActions,
  NeedsYouRows,
  PersonSourceBody,
  SECTION_LABELS,
  SectionRow,
  SourceBadge,
  SourceWay,
  Unanswered,
  drawnSections,
  personTitle,
  rowOf,
  unanswered,
  useSectionAnswers,
  type SectionAnswer,
} from '../components/people/entity-sections';
import { OwnCompetence } from './competence';
import { PlanTab } from './boarding';
import { employmentLabel, employmentPercent, employmentTitles } from './person-model';
import { PageFrame } from '../components/shell/page-frame';
import { entityPageSubject } from '../components/conversation/page-conversation';

/** The page's heading when the person cannot be read, in the browser's tab too. */
const FAILED_TITLE = 'Personen kunde inte läsas';

/** The rail's width and the facts' panel beside the column (`EntityPage`). */
const SIDE_NAV = 260,
  FACTS = 340;
/**
 * A source's fuller read is drawn as a table where the column has the 1020 px a tool's page gives it beside the rail and
 * the facts.
 */
const TABLE_QUERY = `(min-width: ${SIDE_NAV + 1020 + FACTS}px)`;
/** The tab the page opens on, which has no `section` in the address. */
export const OVERVIEW = 'overview';
/** The bar under an employment's share of full time is as wide as the board draws it. */
const SHARE_WIDTH = 160;
/**
 * Kontakt on a phone and at 400 % zoom: each label above its value, as Astryx advises for long values, so an e-mail
 * address takes the column's whole width; in the facts' panel the labels stand beside, as the board draws them.
 */
const LABELS_ABOVE = { position: 'top' } as const;
const phoneLabel = new Map([
  ['work', 'Arbete'],
  ['mobile', 'Mobil'],
  ['home', 'Hem'],
  ['fax', 'Fax'],
  ['pager', 'Personsökare'],
  ['other', 'Övrigt'],
]);
/**
 * The line under the name (board Person: "Lärare, åk 4–6 · Bergsåkers skola"): the titles of the person's employments
 * (D124 item 6), else the directory's own title for them (D110), and their unit. The pane beside a conversation about
 * the person draws the same line (D126 rule 2).
 */
export function nameLine(detail: EntityDetail): string | undefined {
  const title =
    (detail.profile ? employmentTitles(detail.profile.employments) : null) ??
    detail.profile?.title ??
    personTitle(detail.entity);
  return [title, detail.entity.unit?.label].filter(Boolean).join(' · ') || undefined;
}

/**
 * The facts of a person's page (board Person: Anställning, Kontakt), the end panel beside the read and above it where
 * the window is narrow. Anställning: each employment's title where there are several, its unit, form, start and share
 * of full time with its bar, and "Chef: Du" for the reader's own report. Kontakt: how the person is reached and the
 * user name the directory knows them by (D124 item 7: in code type), and for a reader with `admin.users` whether the
 * person has signed in (Inloggning), which Administration › Användare no longer shows as a column. Enhet: their unit, a link to its page where the
 * server says the reader may open it (D117). Nothing the directory has not given is drawn.
 */
function PersonFacts({ detail, from }: { detail: EntityDetail; from: string | null }) {
  const mobile = useMediaQuery(mobileQuery);
  const { entity, relation, profile } = detail;
  // An employment with nothing more than its title (which the name's line already says) has no facts to list.
  const employments = (profile?.employments ?? []).filter(
    (e, _, all) =>
      (all.length > 1 && !!employmentLabel(e)) ||
      !!e.employmentType ||
      !!e.startDate ||
      e.employmentPercentage !== undefined,
  );
  const unit = entity.unit;
  const here = personPageHref(entity.key, { from });
  // The person's row as Användare reads it, asked for by id; only for a reader the server lets read that list.
  const administers = useHeldCapabilities().includes('admin.users');
  const account = useQuery({ ...adminQueries.usersPage({ personId: entity.key }), enabled: administers }).data?.rows[0];
  return (
    <VStack gap={8}>
      {(employments.length > 0 || relation === 'managed') && (
        <RailSection title="Anställning">
          <VStack gap={4}>
            {employments.map((employment, index) => (
              <MetadataList key={index} label={SECTION_LABELS}>
                {employments.length > 1 && (
                  <MetadataListItem label="Befattning">
                    <Text>{employmentLabel(employment)}</Text>
                  </MetadataListItem>
                )}
                {employment.employmentType && (
                  <MetadataListItem label="Anställningsform">
                    <Text>{employment.employmentType}</Text>
                  </MetadataListItem>
                )}
                {employment.startDate && (
                  <MetadataListItem label="Startdatum">
                    {/* A day, not an instant: written as the same day in every time zone. */}
                    <Timestamp value={employment.startDate} format="date_long" timezoneID="UTC" type="inherit" />
                  </MetadataListItem>
                )}
                {employment.employmentPercentage !== undefined && (
                  <MetadataListItem label="Omfattning">
                    {/* The share is said in words; the bar under it is for the eye. */}
                    <VStack gap={1}>
                      <Text hasTabularNumbers>{employmentPercent(employment.employmentPercentage)}</Text>
                      <VStack width={SHARE_WIDTH} maxWidth="100%" aria-hidden>
                        <ProgressBar
                          label="Sysselsättningsgrad"
                          isLabelHidden
                          value={Math.max(0, Math.min(100, employment.employmentPercentage))}
                        />
                      </VStack>
                    </VStack>
                  </MetadataListItem>
                )}
              </MetadataList>
            ))}
            {relation === 'managed' && (
              <MetadataList label={SECTION_LABELS}>
                <MetadataListItem label="Chef">
                  <Text>Du</Text>
                </MetadataListItem>
              </MetadataList>
            )}
          </VStack>
        </RailSection>
      )}
      <RailSection title="Kontakt">
        <MetadataList label={mobile ? LABELS_ABOVE : SECTION_LABELS}>
          {/* The address is the fact's one link and the number its text, as the board draws Kontakt. */}
          {profile?.email && (
            <MetadataListItem label="E-post">
              <Link href={`mailto:${profile.email}`}>{profile.email}</Link>
            </MetadataListItem>
          )}
          {profile?.phoneNumbers.map(phone => (
            <MetadataListItem
              key={JSON.stringify([phone.type, phone.value])}
              label={phoneLabel.get(phone.type) ?? phone.type}
            >
              <Text>{phone.value.replace(/^tel:/i, '')}</Text>
            </MetadataListItem>
          ))}
          <MetadataListItem label="Användarnamn">
            <Text type="code">{entity.sourceKey}</Text>
          </MetadataListItem>
          {account && (
            <MetadataListItem label="Inloggning">
              <Text>{statusLabel[statusOf(account)]}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </RailSection>
      {unit && (
        <RailSection title="Enhet">
          {unit.opens ? (
            <Link href={unitPageHref(unit.id, { from: here })} weight="semibold" isStandalone>
              {unit.label}
            </Link>
          ) : (
            <Text weight="semibold">{unit.label}</Text>
          )}
        </RailSection>
      )}
    </VStack>
  );
}

/** One of the page's tabs: its value in the address (`section`), its name, and what it carries beside the name. */
export interface PersonTab {
  value: string;
  label: string;
  badge?: ReactNode;
}

/**
 * A person's or a unit's tabs as their page and the pane beside a conversation about them both draw them (D126 rules 2
 * and 9): Översikt, one per source that has something about them (`drawn`), what the page adds of its own (`own`: the
 * reader's own Kompetens and Introduktion), and Ärenden with its count while the reader has work items about them.
 */
export function entityTabs(detail: EntityDetail, drawn: SectionAnswer[], own: PersonTab[] = []): PersonTab[] {
  return [
    { value: OVERVIEW, label: 'Översikt' },
    ...drawn.map(a => ({ value: a.source.capability, label: a.source.title })),
    ...own,
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
  ];
}

/**
 * A source's section on the overview (board Person: "Frånvaro i år" with "Visa allt"): its heading, its system, the row
 * the source answered for the person, and the link to its own tab, where its fuller read is. The pane beside a
 * conversation draws it a level down, under the person's name (`level`).
 */
export function OverviewSection({ answer, href, level }: { answer: SectionAnswer; href: string; level?: 2 | 3 }) {
  const row = rowOf(answer);
  return (
    <PageSection
      title={answer.source.title}
      level={level}
      badge={<SourceBadge source={answer.source} />}
      end={
        <Link href={href} isStandalone>
          Visa allt
          <VisuallyHidden>{` om ${answer.source.title.toLocaleLowerCase('sv-SE')}`}</VisuallyHidden>
        </Link>
      }
    >
      {answer.query.isPending ? (
        <ContentSkeleton
          label={`Hämtar ${answer.source.title.toLocaleLowerCase('sv-SE')} …`}
          rows={2}
          heading={false}
        />
      ) : unanswered(answer) || !row ? (
        <Unanswered answer={answer} />
      ) : (
        <SectionRow source={answer.source} row={row} />
      )}
    </PageSection>
  );
}

/**
 * The person as a page (D126 rule 1, board Person; D97 item 5), at `/people/:key`, the one way a person is shown,
 * reached from a name on Personal or on any row that names them. The thing's page (`EntityPage`): the way back, their
 * avatar, name, title and unit, the actions at the end of the title's line (every one in the one menu "Åtgärder",
 * rule 1 as amended 2026-11-21; the frame's "Fråga AI" beside it opens the assistant's pane about the person beside
 * the page, D136, D138), then the person's
 * sections as tabs, each a link with its own address (`?section=`, D126 rule 9): Översikt (Behöver dig and each
 * source's row in short with "Visa allt"), one tab per source that has something about them (its row and its fuller
 * read; the talk's tab is the talk itself, D126 rule 3), Ärenden (the reader's work items about them) and, on the
 * reader's own page, their own competences (Kompetens) and their own introduction or leaving (Introduktion) (rule 7).
 * A tab is drawn only when the reader may see it and data backs it: a source that answered without a row has none.
 * The facts (Anställning, Kontakt, Enhet) are the end panel, above the read where the window is narrow and while the
 * assistant's pane stands beside the page.
 *
 * Old addresses keep working (rule 3): `?section=<capability>` and `needs-you` are the tabs they named;
 * `?talk=<personId>`, the drawer that lay over the page, is the talk's tab, replaced in the history. "Registrera intyg"
 * (`?register=<id>`, a query alone) is a dialog over this page and closes by replacing the address, so the person stays
 * where they are and Back never opens it again. A person the reader may not ask about is the page's own "finns inte"
 * (the server answers 404 for both).
 */
export function PersonPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { key = '' } = useParams<{ key: string }>();
  const [search] = useSearchParams();
  const { pathname, search: here } = useLocation();
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const section = search.get('section') || OVERVIEW;
  const read = useQuery(entityDetailQuery('person', key));
  const detail = read.data;
  const own = key === user.id || detail?.relation === 'self';
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  // The tab and the heading say the same: the page fails on a read it has nothing drawn from. A drawn page whose
  // refetch fails keeps its content, as the administration's pages do.
  const failed = read.isError && !missing && !detail;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? []);
  const areas = useQuery(areasQuery).data;
  // The person's own plans, for their own page's tab (D124): a plan the server lists as theirs.
  const plans = useQuery({ ...boardingPlansQuery, enabled: own }).data;
  const origin = originOf(from, areas?.menu);
  const tool = toolOf(from);

  // `?talk=<personId>` laid the talk over the page before D126: the talk's tab is its place now.
  const talkSource = detail?.sections.find(s => sourceTab(s.page) === 'talk');
  const moved =
    detail && search.has(TALK_PARAM) ? overlayRedirect(pathname, search, { talk: talkSource?.capability }) : null;
  useLayoutEffect(() => {
    if (moved) navigate(moved, { replace: true });
  }, [moved]);

  // The rail marks the place the person was opened from; without one, Personal for the reader's own people.
  const current: NavCurrent =
    from?.split('?')[0] === '/admin/users'
      ? { surface: 'admin', section: 'anvandare' }
      : from?.split('?')[0] === '/admin/organisation'
        ? { surface: 'admin', section: 'organisation' }
        : from?.startsWith('/staff') || from?.startsWith('/competence/') || from?.startsWith('/boarding')
          ? { surface: 'staff' }
          : tool
            ? { surface: 'verktyg', view: tool }
            : from === '/' || from?.startsWith('/?')
              ? { surface: 'start' }
              : from?.startsWith('/todo')
                ? { surface: 'todo' }
                : !from && detail?.relation === 'managed'
                  ? { surface: 'staff' }
                  : { surface: 'verktyg', view: null };
  const nav = useNav({ current, admin, manager: user.role === 'manager' });

  // The tabs the page has: a source's only once it has a row, or while it is on its way, or when it did not answer.
  const drawn = drawnSections(answers);
  const sees = (connector: string) => !areas?.systems || areas.systems.some(s => s.connector === connector);
  const tabs: PersonTab[] = detail
    ? entityTabs(detail, drawn, [
        // The address that names it keeps the tab, so a module switched off says so in its place.
        ...(own && (sees('competence') || section === OWN_COMPETENCE)
          ? [{ value: OWN_COMPETENCE, label: 'Kompetens' }]
          : []),
        ...(own && (plans?.own.length ?? 0) > 0 ? [{ value: OWN_PLAN, label: 'Introduktion' }] : []),
      ])
    : [];
  // A section the address names that the page does not have (a source with nothing, an address from before) is the
  // overview; one still on its way is kept, so the tab is there when it answers.
  const pendingTab = answers.some(a => a.source.capability === section && a.query.isPending);
  const tab = tabs.some(t => t.value === section) || pendingTab ? section : OVERVIEW;
  const tabName = tabs.find(t => t.value === tab)?.label;
  usePageTitle(
    missing
      ? 'Personen finns inte'
      : detail
        ? tab === OVERVIEW || !tabName
          ? detail.entity.name
          : `${tabName} · ${detail.entity.name}`
        : failed
          ? FAILED_TITLE
          : null,
  );
  const tabHref = (value: string) => personPageHref(key, { ...(value === OVERVIEW ? {} : { section: value }), from });

  let body: ReactNode;
  if (missing || !detail)
    body = (
      // Until the person is read, and when they are missing, the page has no subject yet and no button.
      <PageFrame ask={{ subject: null }}>
        {missing ? (
          <EmptyState
            headingLevel={1}
            title="Personen finns inte"
            description="Det finns ingen sådan person, eller så har du inte tillgång till uppgifterna om hen. Adressen kan också ha ändrats."
            actions={<Button label="Till startsidan" href="/" />}
          />
        ) : failed ? (
          <VStack gap={3}>
            {/* The page keeps its one level-1 heading when the person cannot be read: what is missing, the alert why. */}
            <Heading level={1}>{FAILED_TITLE}</Heading>
            <Text as="p" role="alert">
              {errorMessage(read.error, 'Tjänsten kunde inte nås. Försök igen.')}
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
          <ContentSkeleton name="Person" />
        )}
      </PageFrame>
    );
  else {
    const { name } = detail.entity;
    // The way back (board Person): the page in `from` when Clew can name it, else Personal for the reader's own people.
    const back = origin ?? (!from && detail.relation === 'managed' ? { label: 'Personal', href: '/staff' } : null);
    // What the assistant beside the page is about (D136 items 1 to 4 and 7): the person, the same subject from every tab
    // (the product owner, 2026-11-14: one conversation per person, not one per tab), told to the server by Clew's id
    // with every question. The tab only says what the pane beside the conversation it opens as shows first, where that
    // pane has the tab (a source's or Ärenden; the reader's own Kompetens and Introduktion write, and stay on this
    // page). What a source says about a person is never the assistant's (D97 item 7): no chip, and the pane names a
    // section's system it cannot read.
    const shownFirst = drawn.some(a => a.source.capability === tab) || tab === NEEDS_YOU ? tab : null;
    const subject = entityPageSubject({
      kind: 'person',
      id: detail.entity.key,
      name,
      relation: detail.relation,
      sections: detail.sections,
      views: areas?.views,
      tab: shownFirst,
    });
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
    else if (tab === OWN_COMPETENCE) sections = [{ key: OWN_COMPETENCE, node: <OwnCompetence /> }];
    else if (tab === OWN_PLAN) sections = [{ key: OWN_PLAN, node: <PlanTab user={user} personId={key} /> }];
    else if (answer)
      sections = [
        {
          key: answer.source.capability,
          node: (
            <PageSection
              title={answer.source.title}
              badge={<SourceBadge source={answer.source} />}
              end={
                sourceTab(answer.source.page) ? undefined : <SourceWay source={answer.source} entity={detail.entity} />
              }
            >
              {sourceTab(answer.source.page) === 'talk' ? (
                <TalkTab
                  personId={detail.entity.id ?? key}
                  name={name}
                  fallback={<PersonSourceBody answer={answer} tableQuery={TABLE_QUERY} about={name} />}
                />
              ) : (
                <PersonSourceBody answer={answer} tableQuery={TABLE_QUERY} about={name} />
              )}
            </PageSection>
          ),
        },
      ];
    else
      sections = [
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
    body = (
      <EntityPage
        ask={{ subject }}
        back={back}
        icon={<Avatar name={name} size={mobile ? 48 : 60} tooltip={false} aria-hidden />}
        title={name}
        subtitle={nameLine(detail)}
        actions={<EntityActions subject={detail.entity} actions={detail.actions} mobile={mobile} />}
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
        empty={
          <EmptyState
            isCompact
            headingLevel={2}
            title={own ? 'Inget mer att visa om dig' : `Inget mer att visa om ${name}`}
          />
        }
        details={<PersonFacts detail={detail} from={from} />}
        label={tabName && tab !== OVERVIEW ? `${tabName}, ${name}` : name}
      />
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
      {/* "Registrera intyg" from the Kompetens tab (`?register=<id>`, a query alone) is a dialog over this page:
          closing it replaces the address, so the person stays where they are and Back never opens it again. */}
      {user.role === 'manager' && <RegisterHolding />}
    </Shell>
  );
}
