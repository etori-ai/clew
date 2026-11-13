import { useCallback, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityDetail, SessionUser } from '@clew/contracts';
import {
  Avatar,
  Button,
  ClickableCard,
  EmptyState,
  HStack,
  Layout,
  LayoutContent,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
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
import { NEEDS_YOU, insideClew, originOf, personPageHref, toolOf, unitPageHref } from '../person-address';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { FieldValue } from '../components/view';
import { ContentSkeleton } from '../components/loading';
import { RAIL, panelBesideQuery } from '../components/panel';
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
  PersonSourceBody,
  SECTION_LABELS,
  SourceBadge,
  SourceWay,
  drawnSections,
  personTitle,
  useSectionAnswers,
} from '../components/entity-sections';
import { employmentLabel, employmentPercent } from './person-model';

/** The details rail's width beside the column (`EntityPage`). */
const DETAILS = 340;
/**
 * Kontaktuppgifter on a phone and at 400 % zoom: each label above its value, as Astryx advises for long values, so an
 * e-mail address and every number take the column's whole width and a long category the directory sent wraps on a
 * line of its own. A 140 px label column would leave them 132 px at 320 px and break an ordinary address over lines.
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
 * The line under the name. The employments carry their own titles in their section (D114), so it is the core title
 * only where no employment has one.
 */
const shownTitle = (detail: EntityDetail): string | null =>
  detail.profile?.employments.some(employment => employment.title)
    ? null
    : (detail.profile?.title ?? personTitle(detail.entity) ?? null);
/**
 * A section's fuller read is drawn as a table where the column has the 1020 px a tool's page gives it beside the rail:
 * a window of 1280 px plus the details rail.
 */
const TABLE_QUERY = panelBesideQuery(1280 - RAIL, DETAILS);
/** With the panel beside the page the rail is behind "Visa detaljer", and the table needs the panel's width instead. */
const TABLE_BESIDE_QUERY = panelBesideQuery(1280 - RAIL);

/**
 * The details rail of a person's page (board Person): "Detaljer", what the directory (Katalogen) says of them that the
 * page has (their title, their user name, and that the reader is their manager), and "Tillhör", their unit, a link to
 * the unit's page where the server says the reader may open it (a unit they manage or belong to) and its name
 * otherwise. Nothing the directory has not given is drawn.
 */
function PersonDetails({ detail, from }: { detail: EntityDetail; from: string | null }) {
  const { entity, relation } = detail;
  const title = shownTitle(detail);
  const unit = entity.unit;
  const opens = !!unit?.opens;
  const body = unit && (
    <VStack gap={0}>
      <Text type="supporting" color="secondary">
        Enhet
      </Text>
      <Text weight="semibold">{unit.label}</Text>
    </VStack>
  );
  return (
    <VStack gap={10}>
      <RailSection title="Detaljer" caption="Katalogen">
        <MetadataList>
          {title && (
            <MetadataListItem label="Titel">
              <Text>{title}</Text>
            </MetadataListItem>
          )}
          <MetadataListItem label="Användarnamn">
            <Text>{entity.sourceKey}</Text>
          </MetadataListItem>
          {relation === 'managed' && (
            <MetadataListItem label="Chef">
              <Text>Du</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </RailSection>
      {unit && (
        <RailSection title="Tillhör">
          {opens ? (
            <ClickableCard
              label={`Enhet: ${unit.label}`}
              href={unitPageHref(unit.id, { from: personPageHref(entity.key, { from }) })}
              padding={3}
            >
              {body}
            </ClickableCard>
          ) : (
            body
          )}
        </RailSection>
      )}
    </VStack>
  );
}

/**
 * The person as a page (D112 item 5, board Person; D97 item 5), at `/people/:key`, the one way a person is shown (D111
 * rule 3), reached from a name on Personal or on any row that names them. The work item's page shape (`EntityPage`):
 * the way back with their unit, their avatar, name and title, and every action about them with "Fråga Clew" in the
 * header; in the main column "Behöver dig" (the reader's work items about them), then what the directory sent about
 * them (D114), "Anställningar" and "Kontaktuppgifter", each only when something was sent for it, and then one section
 * per source that has something about them, one under the other, each with its source's badge; the directory's other
 * facts and their unit in the rail. `?section=` names a section: the page scrolls to it and its heading takes the
 * focus, so old links, "N att agera på" on Personal and a talk's way back land where they did. A person the reader may
 * not ask about is the page's own "finns inte" (the server answers 404 for both).
 *
 * The page holds the panel beside its column (D111 rules 2 to 4, `usePagePanel`): a work item under Behöver dig and the
 * one an action makes open there, with the address kept, and closing leaves the page as it was. While the panel holds
 * something beside the page the details are behind "Visa detaljer"; in a narrower window the panel is the drawer over
 * the page.
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
  // A decision made on a work item beside the page changes what Behöver dig holds: the person is read again, their
  // sources not.
  const client = useQueryClient();
  const cardChanged = useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.entities.detail('person', key), exact: true });
  }, [client, key]);
  // "Fråga Clew" (D112 item 7): the person on the page is the thing the panel is about. What a source says about a
  // person never reaches the model (D97 item 7), so the question goes without a chip: the conversation is drawn beside
  // the person, and the person is named only where the one asking names them.
  const pageThing: OwnThing | null = detail
    ? {
        id: `page:person:${key}`,
        title: detail.entity.name,
        subtitle: 'Personen på sidan',
        subject: { key: `person:${key}`, label: 'personen', chips: [], search: '' },
      }
    : null;
  const panel = usePagePanel({ overlayOnly: short, onChange: cardChanged, pageThing });
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? []);
  const origin = originOf(from, useQuery(areasQuery).data?.menu);
  const tool = toolOf(from);
  // The rail marks the place the person was opened from; without one, Personal for the reader's own people.
  const current: RailCurrent =
    from?.split('?')[0] === '/admin/users'
      ? { surface: 'admin', section: 'anvandare' }
      : from?.split('?')[0] === '/admin/organisation'
        ? { surface: 'admin', section: 'organisation' }
        : from?.startsWith('/staff')
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
  // The section the address names takes the focus, unless something opened over or beside the page holds it.
  const hold = panel.ref !== null || search.has('talk') || search.has('review');
  const headingRef = useAddressedSection(section, key, hold);

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
                title="Personen finns inte"
                description="Det finns ingen sådan person, eller så har du inte tillgång till uppgifterna om hen. Adressen kan också ha ändrats."
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
    // The way back (board Person): the page in `from` when Clew can name it, else Personal for the reader's own people.
    const back = origin ?? (!from && detail.relation === 'managed' ? { label: 'Personal', href: '/staff' } : null);
    const tableQuery = panel.occupied ? TABLE_BESIDE_QUERY : TABLE_QUERY;
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
      ...(detail.profile?.employments.length
        ? [
            {
              key: 'employments',
              node: (
                <PageSection title="Anställningar" headingRef={headingRef('employments')}>
                  {/* Astryx's List keeps the list and its count for VoiceOver on Safari (role="list"). */}
                  <List aria-label="Anställningar" hasDividers edge="flush">
                    {detail.profile.employments.map((employment, index) => (
                      <ListItem
                        key={index}
                        // Text that wraps, never cut short at 320 px.
                        label={<Text weight="semibold">{employmentLabel(employment)}</Text>}
                        description={
                          <VStack gap={1}>
                            {employment.title && employment.unitLabel && (
                              <Text color="secondary">{employment.unitLabel}</Text>
                            )}
                            {(employment.employmentType ||
                              employment.startDate ||
                              employment.employmentPercentage !== undefined) && (
                              // Short labels and short values: beside each other at every width.
                              <MetadataList label={SECTION_LABELS}>
                                {employment.employmentType && (
                                  <MetadataListItem label="Anställningsform">
                                    {employment.employmentType}
                                  </MetadataListItem>
                                )}
                                {employment.startDate && (
                                  <MetadataListItem label="Startdatum">
                                    {/* A day, not an instant: written as the same day in every time zone. */}
                                    <Timestamp
                                      value={employment.startDate}
                                      format="date_long"
                                      timezoneID="UTC"
                                      type="inherit"
                                      color="inherit"
                                    />
                                  </MetadataListItem>
                                )}
                                {employment.employmentPercentage !== undefined && (
                                  <MetadataListItem label="Sysselsättningsgrad">
                                    {employmentPercent(employment.employmentPercentage)}
                                  </MetadataListItem>
                                )}
                              </MetadataList>
                            )}
                          </VStack>
                        }
                      />
                    ))}
                  </List>
                </PageSection>
              ),
            },
          ]
        : []),
      ...(detail.profile && (detail.profile.email || detail.profile.phoneNumbers.length > 0)
        ? [
            {
              key: 'contact',
              node: (
                <PageSection title="Kontaktuppgifter" headingRef={headingRef('contact')}>
                  {/* Beside the sources' values where the column is wide, above on a phone (W2). */}
                  <MetadataList label={mobile ? LABELS_ABOVE : SECTION_LABELS}>
                    {detail.profile.email && (
                      <MetadataListItem label="E-post">
                        <FieldValue
                          field={{ key: 'email', label: 'E-post', format: 'email' }}
                          value={detail.profile.email}
                        />
                      </MetadataListItem>
                    )}
                    {detail.profile.phoneNumbers.map(phone => (
                      <MetadataListItem
                        key={JSON.stringify([phone.type, phone.value])}
                        label={phoneLabel.get(phone.type) ?? phone.type}
                      >
                        <FieldValue
                          field={{ key: 'phone', label: 'Telefon', format: 'phone' }}
                          value={phone.value.replace(/^tel:/i, '')}
                        />
                      </MetadataListItem>
                    ))}
                  </MetadataList>
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
            <PersonSourceBody answer={a} tableQuery={tableQuery} />
          </PageSection>
        ),
      })),
    ];
    body = (
      <EntityPage
        back={back}
        place={detail.entity.unit?.label}
        icon={<Avatar name={name} size="lg" tooltip={false} aria-hidden />}
        title={name}
        subtitle={shownTitle(detail) ?? undefined}
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
        details={<PersonDetails detail={detail} from={from} />}
        label={name}
        panel={panel}
      />
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
      {panel.overlay}
      {/* The talk from the talks section's "Öppna samtalet" lies over the page and its panel (D111 rule 5). */}
      {user.role === 'manager' && <TalkOverlay back={detail ? `Tillbaka till ${detail.entity.name}` : 'Tillbaka'} />}
    </Shell>
  );
}
