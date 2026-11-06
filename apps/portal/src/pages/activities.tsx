import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, SessionUser, Thread } from '@clew/contracts';
import { daysUntil } from '@clew/contracts';
import {
  Badge,
  Card,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Grid,
  Heading,
  HStack,
  Tab,
  TabList,
  Text,
  VStack,
  useAnnounce,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { areasQuery, threadsQuery } from '../../../web/src/queries';
import { groupThreads } from '../../../web/src/stream';
import { Handled } from '../../../web/src/components/handled';
import { usePageTitle } from '../../../web/src/page-title';
import { PortalShell } from '../shell';
import { ThreadRows } from '../rows';
import { activitiesHref, conversationHref } from '../hrefs';

const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const noop = () => undefined;
/** The tabs Hem has (D53), named as the address names them (D43). */
type TodoTab = 'needs-you' | 'waiting' | 'snoozed' | 'done';
const tabs: TodoTab[] = ['needs-you', 'waiting', 'snoozed', 'done'];
const tabOf = (value: string | null): TodoTab => (tabs.includes(value as TodoTab) ? (value as TodoTab) : 'needs-you');
const tabTitle: Record<TodoTab, string> = {
  'needs-you': 'Att göra',
  waiting: 'Väntar på andra',
  snoozed: 'Inte nu',
  done: 'Hanterade',
};
const ALL = 'all';

/** One of the four counts at the top of Mina aktiviteter. */
function Count({ label, value }: { label: string; value: number }) {
  return (
    <Card padding={4}>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        <Text size="2xl" weight="semibold">
          {value}
        </Text>
      </VStack>
    </Card>
  );
}

/**
 * Mina aktiviteter as the proof of concept draws it: "allt som väntar på dig, samlat ur N tjänster", the four counts,
 * the filter per service and the rows. The numbers are Hem's groups (`groupThreads`) counted; "Frist passerad" is the
 * overdue badge counted; the tabs and the area filter are Hem's, with the same names in the address.
 */
export function ActivitiesPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const tab = tabOf(search.get('tab'));
  const area = search.get('area');
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const now = new Date().toISOString();
  const todayDate = today();
  const inArea = (t: Thread) => area === null || t.area === area;
  const g = useMemo(() => groupThreads(threads, now, todayDate, inArea), [threads, now.slice(0, 16), todayDate, area]);
  const all = useMemo(() => groupThreads(threads, now, todayDate), [threads, now.slice(0, 16), todayDate]);
  const toDo = useMemo(() => [...g.nu, ...g.foreslar, ...g.senare, ...g.kannedom], [g]);
  const notice = useMemo(() => new Set(g.kannedom.map(t => t.id)), [g.kannedom]);
  const overdue = all.nu.filter(t => t.deadline && daysUntil(t.deadline.slice(0, 10), todayDate) < 0).length;
  const closedToday = all.handledToday.filter(t => t.kind !== 'question');
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
  usePageTitle('Mina aktiviteter');
  // The filter changes the rows under it without a change of page: what is shown now is said aloud (4.1.3).
  const announce = useAnnounce();
  const shownArea = useRef(area);
  useEffect(() => {
    if (shownArea.current === area) return;
    shownArea.current = area;
    announce(area ? `Visar tjänsten ${areaTitle(area)}` : 'Visar alla tjänster');
  }, [area, announce]);
  const count: Record<TodoTab, number> = {
    'needs-you': toDo.length,
    waiting: g.waiting.length,
    snoozed: g.snoozed.length,
    done: g.handledToday.filter(t => t.kind !== 'question').length,
  };
  const rows = tab === 'needs-you' ? toDo : tab === 'waiting' ? g.waiting : tab === 'snoozed' ? g.snoozed : [];
  return (
    <PortalShell user={user} current={{ page: 'activities' }}>
      <VStack gap={6}>
        <VStack gap={1}>
          <Heading level={1}>Mina aktiviteter</Heading>
          <Text type="supporting">
            Allt som väntar på dig, samlat ur {areas.length} {areas.length === 1 ? 'tjänst' : 'tjänster'} och läst
            direkt ur dem.
          </Text>
        </VStack>
        <Grid columns={{ minWidth: 180, max: 4 }} gap={4}>
          <Count
            label="Att göra"
            value={all.nu.length + all.foreslar.length + all.senare.length + all.kannedom.length}
          />
          <Count label="Frist passerad" value={overdue} />
          <Count label="Tjänster" value={areas.length} />
          <Count label="Hanterade i dag" value={closedToday.length} />
        </Grid>
        <HStack justify="between" vAlign="center" gap={2}>
          <TabList value={tab} onChange={next => navigate(activitiesHref({ tab: tabOf(next), area }))} role="tablist">
            {tabs.map(t => (
              <Tab
                key={t}
                value={t}
                label={tabTitle[t]}
                panelId="aktiviteter"
                endContent={
                  count[t] || t === 'needs-you' ? <Badge variant="neutral" label={String(count[t])} /> : undefined
                }
              />
            ))}
          </TabList>
          <DropdownMenu
            button={{
              label: 'Tjänst',
              children: area ? areaTitle(area) : 'Alla tjänster',
              variant: 'ghost',
              size: 'sm',
            }}
            menuWidth={240}
          >
            <DropdownMenuRadioGroup
              label="Tjänst"
              value={area ?? ALL}
              onChange={next => navigate(activitiesHref({ tab, area: next === ALL ? null : next }))}
            >
              <DropdownMenuRadioItem value={ALL} label="Alla tjänster" />
              {areas.map(a => (
                <DropdownMenuRadioItem key={a.id} value={a.id} label={a.title} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenu>
        </HStack>
        <VStack gap={3} id="aktiviteter" role="tabpanel" aria-label={tabTitle[tab]}>
          {threadsQ.isPending ? (
            <Text type="supporting">Hämtar …</Text>
          ) : tab === 'done' ? (
            <Handled
              threads={threads.filter(t => t.state !== 'open' && inArea(t))}
              compact={false}
              onChange={noop}
              conversationHref={conversationHref}
            />
          ) : rows.length ? (
            <ThreadRows threads={rows} notice={notice} />
          ) : (
            <Text type="supporting">Inget här just nu.</Text>
          )}
        </VStack>
      </VStack>
    </PortalShell>
  );
}
