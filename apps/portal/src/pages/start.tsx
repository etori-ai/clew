import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, SessionUser, Thread } from '@clew/contracts';
import { Button, Card, ChatLayout, Grid, Heading, HStack, Link, StatusDot, Text, VStack } from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { areasQuery, completionsQuery, threadsQuery, todayQuery } from '../../../web/src/queries';
import { groupThreads } from '../../../web/src/stream';
import { Composer, Suggestions } from '../../../web/src/components/composer';
import { useConversation } from '../../../web/src/components/conversation-context';
import { Transcript } from '../../../web/src/components/conversation';
import { GenericCard } from '../../../web/src/components/card';
import { ThreadCard } from '../../../web/src/components/thread';
import { Today } from '../../../web/src/components/today';
import { Since } from '../../../web/src/components/since';
import { Handled } from '../../../web/src/components/handled';
import { usePageTitle } from '../../../web/src/page-title';
import { PortalShell } from '../shell';
import { Lage } from '../../../web/src/components/lage';
import { ThreadRows } from '../rows';
import { activitiesHref, cardHref, conversationHref, viewHref } from '../hrefs';

const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const noop = () => undefined;
/** How many rows the start page shows under Att agera på before "Visa alla". */
const ROWS = 8;
const dot = { ok: 'success', warn: 'warning', alert: 'error', none: 'neutral' } as const;

/** "God morgon, Kim!" as the proof of concept greets: by the hour, with the first name. */
const greeting = (name: string, hour = new Date().getHours()) =>
  `${hour < 10 ? 'God morgon' : hour < 17 ? 'God dag' : 'God kväll'}, ${name.split(' ')[0]}!`;

/**
 * The chips under the box as the proof of concept draws them: what the person can start and ask, from the server's
 * completions (D34). A chip puts its words in the box; nothing runs from a chip. "Godkänn 4 ledighetsansökningar" is
 * then a question the box answers with "Menar du" and the card, never a decision the model takes (D45).
 */
function Chips() {
  const completions = useQuery(completionsQuery).data;
  const talk = useConversation();
  const items = [...(completions?.do ?? []), ...(completions?.ask ?? [])].slice(0, 6);
  if (!items.length) return null;
  return (
    <HStack gap={2} wrap="wrap">
      {items.map(item => (
        <Button
          key={item.capability + item.text}
          size="sm"
          variant="secondary"
          label={item.text}
          onClick={() => {
            talk.setValue(item.text);
            talk.focus();
          }}
        />
      ))}
    </HStack>
  );
}

/** One area as a count card (the proof of concept's "Ledighetsansökningar · 7 väntar · 4 klara att godkänna direkt"). */
function AreaCard({ area }: { area: Area }) {
  return (
    <Card padding={4}>
      <VStack gap={1} as="section" aria-label={area.title}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Heading level={3} accessibilityLevel={3}>
            {area.title}
          </Heading>
          {area.figure && area.figure.tone !== 'none' && (
            <StatusDot variant={dot[area.figure.tone]} label={area.figure.label} />
          )}
        </HStack>
        <Text size="2xl" weight="semibold">
          {area.needsYou}
        </Text>
        <Text type="supporting">
          {area.needsYou === 1 ? 'väntar på dig' : 'väntar på dig'} · {area.waiting} väntar på andra
        </Text>
        {area.figure && <Text type="supporting">{area.figure.label}</Text>}
        <Link href={activitiesHref({ area: area.id })}>Visa</Link>
      </VStack>
    </Card>
  );
}

/**
 * The start page as the product owner's proof of concept draws it (D67): the greeting, the box with its chips, the
 * figures, Att agera på with the rows Hem has, the areas as count cards beside I dag and Sedan i går, and what was
 * handled. Every element reads what Hem reads; the intranet's news and sections are not drawn.
 */
export function PortalStart({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const talk = useConversation();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const dayQ = useQuery(todayQuery);
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const now = new Date().toISOString();
  const todayDate = today();
  const g = useMemo(() => groupThreads(threads, now, todayDate), [threads, now.slice(0, 16), todayDate]);
  const closedToday = useMemo(() => g.handledToday.filter(t => t.kind !== 'question'), [g.handledToday]);
  const toDo = useMemo(() => [...g.nu, ...g.foreslar, ...g.senare, ...g.kannedom], [g]);
  const notice = useMemo(() => new Set(g.kannedom.map(t => t.id)), [g.kannedom]);
  const older = threads.filter(t => t.state !== 'open');
  const title = talk.open ? 'Samtal' : 'Start';
  usePageTitle(title);
  const card = (t: Thread) =>
    t.proposals.length ? (
      <ThreadCard key={t.id} thread={t} compact={false} headingLevel={2} onChange={noop} />
    ) : (
      <GenericCard
        key={t.id}
        thread={t}
        headingLevel={2}
        onChange={noop}
        onOpenCardView={(threadId, actionId) => navigate(cardHref(threadId, actionId))}
      />
    );
  if (talk.open)
    return (
      <PortalShell user={user} current={{ page: 'start' }} height="fill">
        <ChatLayout density="balanced" composer={<Composer place="conversation" />}>
          <VStack gap={4}>
            <HStack justify="between" vAlign="center" gap={2}>
              <Heading level={1}>Samtal</Heading>
              <Button size="sm" variant="ghost" label="Stäng samtalet" onClick={talk.close} />
            </HStack>
            <Transcript onOpenView={v => navigate(viewHref(v))} renderCard={card} viewHref={v => viewHref(v)} />
          </VStack>
        </ChatLayout>
      </PortalShell>
    );
  return (
    <PortalShell user={user} current={{ page: 'start' }}>
      <VStack gap={8}>
        <VStack gap={1}>
          <Heading level={1}>{greeting(user.name)}</Heading>
          <Text type="supporting">
            {new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {user.unitLabel}
          </Text>
        </VStack>
        <VStack gap={3}>
          <Composer place="landing" roomy />
          <Suggestions viewHref={(capability, label) => viewHref({ capability, title: label })} cardHref={cardHref} />
          <Chips />
        </VStack>
        {/* The areas' figures as Hem draws them (D54): one tile per area with a figure, from its connector. */}
        <Lage
          areas={areas}
          loading={areasQ.isPending}
          sources={threadsQ.data?.sources}
          now={now}
          unitLabel={user.unitLabel}
          viewHref={(capability, title) => viewHref({ capability, title })}
        />
        <VStack gap={3} as="section" aria-labelledby="att-agera-pa">
          <HStack justify="between" vAlign="center" gap={2}>
            <Heading level={2} id="att-agera-pa">
              Att agera på · {toDo.length}
            </Heading>
            <Link href={activitiesHref()}>Visa alla</Link>
          </HStack>
          {threadsQ.isPending ? (
            <Text type="supporting">Hämtar …</Text>
          ) : toDo.length ? (
            <ThreadRows threads={toDo.slice(0, ROWS)} notice={notice} />
          ) : (
            <Text type="supporting">Inget väntar på dig just nu.</Text>
          )}
        </VStack>
        <Grid columns={{ minWidth: 300, max: 3 }} gap={4}>
          {areas.map(a => (
            <AreaCard key={a.id} area={a} />
          ))}
          {dayQ.data && <Today view={dayQ.data} threads={threads} cardHref={id => cardHref(id)} />}
          {threadsQ.data && (
            <Since
              handled={closedToday}
              waiting={g.waiting}
              sources={threadsQ.data.sources}
              now={now}
              doneHref={activitiesHref({ tab: 'done' })}
            />
          )}
        </Grid>
        {older.length > 0 && (
          <VStack gap={3} as="section" aria-labelledby="hanterat">
            <Heading level={2} id="hanterat">
              Hanterat
            </Heading>
            <Handled threads={older} compact={false} onChange={noop} conversationHref={conversationHref} />
          </VStack>
        )}
      </VStack>
    </PortalShell>
  );
}
