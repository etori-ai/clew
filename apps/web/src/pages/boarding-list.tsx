import { useEffect, type ReactNode } from 'react';
import { useNavigationType } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BOARDING_EVENT_WORDS,
  type BoardingPlanSummary,
  type BoardingSuggestion,
  type SessionUser,
} from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
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
  resolveColumnWidths,
  useMediaQuery,
} from '@clew/ui';
import { BOARDING_PATH, boardingHref } from '../boarding-address';
import { anchorDay, overdueWords, planLine, plansWords, progressWords, shortDay } from '../boarding';
import { boardingPlansQuery, boardingSuggestionsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { RAIL } from '../components/panel';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';

const TITLE = 'Introduktion och avslut';
/** The heading the page gives the focus to when the person arrives by a link, the rail's row. */
const TITLE_ID = 'introduktion-rubrik';
const OWN_ID = 'introduktion-egen';
const SUGGESTED_ID = 'introduktion-forslag';
const PLANS_ID = 'introduktion-planer';
/** The list's column at its widest, as Personal and Kompetens have it: 1216 px less the page's padding on each side. */
const COLUMN = 1216 - 2 * 32;
/** The page's own padding on each side of the column, which the table's least width does not count. */
const PADDING = 32;
/** The columns' widths: the person, the event, the day, the progress and a badge for what is late. */
const WIDTHS = {
  name: proportional(2, { minWidth: 200 }),
  event: pixel(130),
  day: proportional(1.5, { minWidth: 210 }),
  progress: pixel(100),
  status: proportional(1, { minWidth: 130 }),
};
/**
 * The window width from which the table keeps every column's least width beside the rail; narrower, the plans are the
 * rows a phone draws, so the page never scrolls sideways for them (1.4.10) and a name is never read apart from its plan.
 */
const TABLE_MIN = resolveColumnWidths(Object.entries(WIDTHS).map(([key, width]) => ({ key, width }))).tableMinWidth;
const tableQuery = `(min-width: ${RAIL + TABLE_MIN + 2 * PADDING}px)`;

interface Row extends Record<string, unknown> {
  id: string;
  plan: BoardingPlanSummary;
}
/** A plan's page opened from the list, with the list as its way back and the plan chosen. */
const planHref = (plan: Pick<BoardingPlanSummary, 'id' | 'personId'>) =>
  boardingHref(plan.personId, { plan: plan.id, from: BOARDING_PATH });
/** What is late in a plan, as the plan's own header says it; nothing when nothing is. */
const late = (plan: BoardingPlanSummary) =>
  plan.overdue > 0 ? <Badge variant="warning" label={overdueWords(plan.overdue)} /> : null;

/**
 * Introduktion och avslut (D124 item 12, D116: a list is a page), `/boarding`, where the rail's row leads someone who
 * manages a unit or holds a plan to manage. The server's one read (`GET /api/boarding/plans`) says what is theirs: the
 * reader's own open plans, apart and above, when there are any; while any wait, the reports Clew suggests an
 * introduction for (D124 item 8), each with "Starta introduktion", the start dialog over the person's page; and the open
 * plans the reader manages or holds, nearest day first, as the list's card the way Personal draws its units and
 * Kompetens its matrix: a table where its columns fit beside the rail, else a row per plan. Every row's name is the link
 * to the plan's page, which has the list as its way back. Rows carry facts only: the event, its day, how many of its
 * items are done and a badge where any is late. With no open plan a manager is told where plans are started; someone it
 * does not apply to, and the module switched off, are told so.
 *
 * Arrived by a link (the rail's row), the person starts at the heading (2.4.3). Coming back from a plan, by Back or by
 * its way back, the shell gives the focus to the name that opened it (`useFocusOnTheWayBack`), and it stays there; a
 * reload leaves it where the browser puts it.
 */
export function BoardingListPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const wide = useMediaQuery(tableQuery);
  const nav = useRail({ current: { surface: 'boarding' }, admin, manager: user.role === 'manager' });
  usePageTitle(TITLE);
  const plansQ = useQuery(boardingPlansQuery);
  const plans = plansQ.data;
  const manages = !!plans && (plans.manages || plans.rows.length > 0);
  const suggestionsQ = useQuery({ ...boardingSuggestionsQuery, enabled: manages });
  const suggestions = suggestionsQ.data?.rows ?? [];
  // The page is drawn whole: the suggestions above the plans arrive with them, so the plans never move down under the eye.
  const pending = plansQ.isPending || (manages && suggestionsQ.isPending);

  const kind = useNavigationType();
  useEffect(() => {
    if (pending || kind === 'POP') return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    document.getElementById(TITLE_ID)?.focus();
  }, [pending]);

  let body: ReactNode;
  if (pending) body = <ContentSkeleton heading={false} />;
  else if (plansQ.isError)
    body = (
      <VStack gap={2}>
        <Text as="p" role="alert">
          {errorMessage(plansQ.error, 'Planerna kunde inte hämtas just nu.')}
        </Text>
        <HStack>
          <Button
            size="sm"
            variant="secondary"
            label="Försök igen"
            isLoading={plansQ.isFetching}
            onClick={() => void plansQ.refetch()}
          />
        </HStack>
      </VStack>
    );
  else if (!plans)
    body = (
      <Card>
        <EmptyState
          headingLevel={2}
          title="Introduktion och avslut är inte påslaget för dig"
          description="En administratör slår på Introduktion och avslut under Anslutna system."
          actions={<Button label="Till startsidan" href="/" />}
        />
      </Card>
    );
  else if (!manages && plans.own.length === 0)
    body = (
      <Card>
        <EmptyState
          headingLevel={2}
          title="Ingen introduktion eller något avslut för dig"
          description="Här ser du din egen introduktion eller ditt avslut när din chef har startat det, och som chef planerna för dem du är chef för."
          actions={<Button label="Till startsidan" href="/" />}
        />
      </Card>
    );
  else
    body = (
      <>
        {plans.own.length > 0 && <OwnPlans rows={plans.own} />}
        {manages && suggestionsQ.isError && (
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Text as="p" role="alert">
              {errorMessage(suggestionsQ.error, 'Förslagen kunde inte hämtas just nu.')}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              label="Försök igen"
              isLoading={suggestionsQ.isFetching}
              onClick={() => void suggestionsQ.refetch()}
            />
          </HStack>
        )}
        {manages && suggestions.length > 0 && <Suggested rows={suggestions} />}
        {manages && <Plans rows={plans.rows} narrow={mobile || !wide} />}
      </>
    );

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                <PageHeader title={TITLE} titleId={TITLE_ID} />
                {body}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Shell>
  );
}

/** A card's heading in its toolbar, as Kompetens's "Att granska" has it: the title at level 2 and what it holds. */
function CardHeading({ id, title, count }: { id: string; title: string; count?: string }) {
  return (
    <Toolbar
      label={title}
      size="sm"
      dividers={['bottom']}
      startContent={
        <VStack gap={0} hAlign="start">
          <Heading id={id} level={2}>
            {title}
          </Heading>
          {count && <Text type="supporting">{count}</Text>}
        </VStack>
      }
    />
  );
}

/**
 * The reader's own open plans (an introduction, a leaving, or both), apart from those they manage and above them. Each
 * row's event is the link to the plan's page; under it its day and progress, and a badge where an item is late.
 */
function OwnPlans({ rows }: { rows: BoardingPlanSummary[] }) {
  return (
    <Card padding={0}>
      <CardHeading id={OWN_ID} title={rows.length === 1 ? 'Din plan' : 'Dina planer'} />
      <List aria-labelledby={OWN_ID} hasDividers>
        {rows.map(plan => (
          <ListItem
            key={plan.id}
            itemKey={plan.id}
            label={
              <Link href={planHref(plan)} weight="semibold" hasUnderline>
                {BOARDING_EVENT_WORDS[plan.event]}
              </Link>
            }
            description={
              <Text type="supporting">{`${anchorDay(plan.event, plan.anchorOn)} · ${progressWords(plan.done, plan.total)} klara`}</Text>
            }
            endContent={late(plan)}
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * The reports Clew suggests an introduction for (D124 item 8: an employment that starts within six weeks with no
 * introduction), above the plans while any wait, as "Att granska" stands above Kompetens's matrix. The name leads to
 * the person's page of introduction and leaving; "Starta introduktion" at the row's end opens the start dialog over it
 * (`?start=introduction`), named with the person. The day is the directory's, and only prefills the dialog.
 */
function Suggested({ rows }: { rows: BoardingSuggestion[] }) {
  return (
    <Card padding={0}>
      <CardHeading
        id={SUGGESTED_ID}
        title="Nya medarbetare utan introduktion"
        count={rows.length === 1 ? '1 medarbetare' : `${rows.length} medarbetare`}
      />
      <List aria-labelledby={SUGGESTED_ID} hasDividers>
        {rows.map(s => (
          <ListItem
            key={s.personId}
            itemKey={s.personId}
            label={
              <Link href={boardingHref(s.personId, { from: BOARDING_PATH })} weight="semibold" hasUnderline>
                {s.name}
              </Link>
            }
            description={<Text type="supporting">{`Börjar ${shortDay(s.startOn)} enligt katalogen`}</Text>}
            endContent={
              <Button
                size="sm"
                variant="secondary"
                label="Starta introduktion"
                aria-label={`Starta introduktion för ${s.name}`}
                href={boardingHref(s.personId, { start: 'introduction', from: BOARDING_PATH })}
              />
            }
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * The open plans the reader manages or holds, nearest day first as the server orders them: a table of the person (the
 * link to the plan), the event, its day, how many items are done and a badge where any is late; `narrow`, the same
 * facts as a row per plan with the name on top. With none, where plans are started.
 */
function Plans({ rows, narrow }: { rows: BoardingPlanSummary[]; narrow: boolean }) {
  const name = (plan: BoardingPlanSummary) => (
    <Link href={planHref(plan)} weight="semibold" hasUnderline>
      {plan.name}
    </Link>
  );
  return (
    <Card padding={0}>
      <CardHeading
        id={PLANS_ID}
        title="Medarbetarnas planer"
        count={rows.length ? plansWords(rows.length) : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState
          isCompact
          headingLevel={3}
          title="Inga pågående planer"
          description="En introduktion eller ett avslut för någon du är chef för startas från personens sida eller från Personal, och står här tills den avslutas."
          actions={<Button size="sm" variant="secondary" label="Till Personal" href="/staff" />}
        />
      ) : narrow ? (
        <List aria-labelledby={PLANS_ID} hasDividers>
          {rows.map(plan => (
            <ListItem
              key={plan.id}
              itemKey={plan.id}
              label={name(plan)}
              description={
                <VStack gap={1} hAlign="start">
                  {late(plan)}
                  <Text type="supporting">{planLine(plan)}</Text>
                </VStack>
              }
            />
          ))}
        </List>
      ) : (
        <Table<Row>
          aria-labelledby={PLANS_ID}
          data={rows.map(plan => ({ id: plan.id, plan }))}
          idKey="id"
          columns={[
            { key: 'name', header: 'Medarbetare', width: WIDTHS.name, renderCell: r => name(r.plan) },
            {
              key: 'event',
              header: 'Plan',
              width: WIDTHS.event,
              renderCell: r => <Text>{BOARDING_EVENT_WORDS[r.plan.event]}</Text>,
            },
            {
              key: 'day',
              header: 'Dag',
              width: WIDTHS.day,
              renderCell: r => <Text>{anchorDay(r.plan.event, r.plan.anchorOn)}</Text>,
            },
            {
              key: 'progress',
              header: 'Klara',
              width: WIDTHS.progress,
              renderCell: r => <Text hasTabularNumbers>{progressWords(r.plan.done, r.plan.total)}</Text>,
            },
            { key: 'status', header: 'Status', width: WIDTHS.status, renderCell: r => late(r.plan) },
          ]}
          density="balanced"
          hasHover
        />
      )}
    </Card>
  );
}
