import { useEffect, useRef, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { EntityAction, EntityDetail, SessionUser } from '@clew/contracts';
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
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useEntityAction } from '../entity-actions';
import { insideClew, originLabel, personPageHref } from '../person-address';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery } from '../components/shell';
import { PageHeader } from '../components/page-header';
import { ContentSkeleton } from '../components/loading';
import { PersonActions } from '../components/person-panel';
import {
  CardList,
  NEEDS_YOU,
  OpenRead,
  SectionNav,
  SectionRow,
  Unanswered,
  drawnSections,
  openOf,
  pageHref,
  rowOf,
  sectionNavRows,
  unanswered,
  useSectionAnswers,
  type SectionAnswer,
} from '../components/entity-sections';

/** The `settings-sidebar` template's breakpoint: below it the list of sections and the chosen one are two steps. */
const narrowQuery = '(max-width: 768px)';
/** The fuller view's table needs the page beside the list of sections. */
const tableQuery = '(min-width: 1280px)';

/** Where the page was opened from, as the way back names it; a tool's page is named by its row in the menu. */
function useOrigin(from: string | null): { label: string; href: string } | null {
  const menu = useQuery(areasQuery).data?.menu;
  if (!from) return null;
  const tool = /^\/tools\/([^/?]+)/.exec(from)?.[1];
  const label = originLabel(from) ?? (tool ? menu?.find(m => m.capability === decodeURIComponent(tool))?.label : null);
  return label ? { label, href: from } : null;
}

/** The chosen source's fuller view (artboard C2): its name, where it was read and when, its actions, then its read in full. */
function ChosenSection({
  detail,
  answer,
  level,
}: {
  detail: EntityDetail;
  answer: SectionAnswer;
  level: 'page' | 'drill';
}) {
  const start = useEntityAction();
  const { key, name, id } = detail.entity;
  const row = rowOf(answer);
  const page = pageHref(answer.source, key, id);
  const own = detail.actions.filter(a => a.connector === answer.source.connector);
  const run = (a: EntityAction) => start(a, { key, name });
  const read = answer.query.dataUpdatedAt;
  return (
    <VStack gap={5}>
      <HStack gap={3} justify="between" vAlign="center" wrap="wrap">
        <VStack gap={0}>
          {level === 'page' && <Heading level={2}>{answer.source.title}</Heading>}
          <Text type="supporting">
            {answer.source.source}
            {row && read ? (
              <>
                {' · hämtat '}
                <Timestamp value={new Date(read).toISOString()} format="relative" isLive />
              </>
            ) : null}
          </Text>
        </VStack>
        {(own.length > 0 || page) && (
          <HStack gap={2} wrap="wrap" vAlign="center">
            {own.map(a => (
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

/** Behöver dig as the chosen section: the reader's cards about the person, each leading to the card on Hem. */
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
 * The person as a page (D97 item 5, artboard C2), at `/people/:key`, reached with "Öppna som sida": the trail back to
 * the list, the person's name with their actions, the list of sections ("Om <namn>", each with its source and one line)
 * and beside it the chosen source's fuller view, `?section=` in the address. On a narrow window the two are the
 * `settings-sidebar` template's drill-in: the list, then the chosen section with the way back to the list. A person the
 * reader may not ask about is the page's own "finns inte" (the server answers 404 for both).
 */
export function PersonPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { key = '' } = useParams<{ key: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const narrow = useMediaQuery(narrowQuery);
  const from = insideClew(search.get('from'));
  const section = search.get('section') || undefined;
  const read = useQuery(entityDetailQuery('person', key));
  const detail = read.data;
  const missing = read.isError && read.error instanceof ApiError && read.error.status === 404;
  const answers = useSectionAnswers(detail?.entity.key, detail?.sections ?? []);
  const origin = useOrigin(from);
  const tool = from ? /^\/tools\/([^/?]+)/.exec(from)?.[1] : undefined;
  // The rail marks the place the person was opened from: Personal for the reader's own people.
  const current: RailCurrent =
    detail?.relation === 'managed' || from?.startsWith('/staff')
      ? { surface: 'staff' }
      : tool
        ? { surface: 'verktyg', view: decodeURIComponent(tool) }
        : from === '/' || from?.startsWith('/?')
          ? { surface: 'start' }
          : { surface: 'verktyg', view: null };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });
  usePageTitle(detail ? detail.entity.name : missing ? 'Personen finns inte' : null);
  // The trail (artboard C2): Personal for the reader's own people, else the place they came from when it is known.
  const back =
    detail?.relation === 'managed'
      ? { label: 'Personal', href: from?.startsWith('/staff') ? from : '/staff' }
      : detail
        ? origin
        : null;
  const drawn = drawnSections(answers);
  const fallback = detail ? (detail.cards.length > 0 ? NEEDS_YOU : drawn[0]?.source.capability) : undefined;
  const chosenId = section ?? (narrow ? undefined : fallback);
  const chosen = chosenId ? answers.find(a => a.source.capability === chosenId) : undefined;
  const showsCards = chosenId === NEEDS_YOU && !!detail && detail.cards.length > 0;
  const hrefFor = (id: string | null) => personPageHref(key, { ...(id ? { section: id } : {}), from });
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
        <Card padding={0} {...(narrow ? {} : { width: 340 })}>
          <SectionNav rows={sectionNavRows(detail.cards, answers, hrefFor, narrow ? undefined : chosenId)} />
        </Card>
      </VStack>
    );
    const view = showsCards ? (
      <ChosenCards detail={detail} level={narrow ? 'drill' : 'page'} />
    ) : chosen ? (
      <ChosenSection detail={detail} answer={chosen} level={narrow ? 'drill' : 'page'} />
    ) : null;
    const chosenTitle = showsCards ? 'Behöver dig' : chosen?.source.title;
    body = (
      <>
        <PageHeader
          title={name}
          icon={<Avatar name={name} size={60} tooltip={false} aria-hidden />}
          end={<PersonActions detail={detail} mobile={mobile} />}
          {...(detail.entity.detail ? { meta: <Text color="secondary">{detail.entity.detail}</Text> } : {})}
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
    <Shell user={user} nav={nav}>
      <Layout
        height="auto"
        contentWidth={1216}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={false}>
            <VStack gap={5}>
              {back && (
                <Breadcrumbs label="Du är här" variant="supporting" separator="›">
                  <BreadcrumbItem href={back.href}>{back.label}</BreadcrumbItem>
                  <BreadcrumbItem isCurrent>{detail!.entity.name}</BreadcrumbItem>
                </Breadcrumbs>
              )}
              {body}
            </VStack>
          </LayoutContent>
        }
      />
    </Shell>
  );
}
