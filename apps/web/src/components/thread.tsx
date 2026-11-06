import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { obligationStep, obligationSteps, replySummary, type CalendarEvent, type Thread } from '@clew/contracts';
import {
  Avatar,
  AvatarGroup,
  AvatarGroupOverflow,
  Badge,
  Button,
  Card,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  CheckboxList,
  CheckboxListItem,
  Collapsible,
  Heading,
  HStack,
  Icon,
  List,
  ListItem,
  MoreMenu,
  Step,
  Stepper,
  Text,
  Timestamp,
  Token,
  VStack,
  VisuallyHidden,
  WeekAgenda,
  agendaItems,
} from '@clew/ui';
import { useConversation } from './conversation-context';
import { TimePicker, useLeaveWithUndo, useSnoozeRows } from './card';
import { addDays, shortDayLabel, timeRange, weekNumber } from '@clew/calendar/dates';
import { api } from '../api';
import { calendarWeekQuery } from '../queries';
import { useThreadAction } from '../mutations';
import { executionStatus } from '../execution-status';

type Props = {
  thread: Thread;
  compact: boolean;
  headingLevel?: 2 | 3 | 4;
  onChange: (thread: Thread) => void;
  /** The card in the panel beside its own row (D50): the row keeps the thread's id, so the card takes another. */
  beside?: boolean;
};
const EMPTY_EVENTS: CalendarEvent[] = [];

const stepLabel = { forslag: 'Förslag', inbjudningar: 'Inbjudningar', svar: 'Svar', klart: 'Klart' } as const;
/** The thread's state in words; the Stepper carries it too (D30). Only a proposal waiting for the person is a status that needs action, and the one badge. */
const statusLine = (thread: Thread) => {
  const pending = executionStatus(thread.execution);
  if (pending) return { badge: false, label: pending };
  if (thread.kind === 'question')
    return {
      badge: false,
      label: Date.now() - Date.parse(thread.createdAt) < 3600_000 ? 'Du frågade nyss' : 'Du frågade',
    };
  if (thread.state === 'dismissed') return { badge: false, label: 'Avfärdad' };
  const step = obligationStep(thread.proposals),
    sum = replySummary(thread.proposals);
  if (step === 'klart')
    return { badge: false, label: sum.declined ? `Alla har svarat · ${sum.declined} nej` : 'Alla har svarat ja' };
  if (step === 'svar') return { badge: false, label: `Svar · ${sum.accepted} av ${sum.total}` };
  if (step === 'inbjudningar') return { badge: false, label: 'Inbjudningar skickade' };
  return { badge: true, label: 'Förslag att bekräfta' };
};
/** The first assistant message is the lead: one sentence, then the assessment. */
function split(body: string) {
  const index = body.search(/[.!?]\s/);
  return index > 0 ? { lead: body.slice(0, index + 1), rest: body.slice(index + 2).trim() } : { lead: body, rest: '' };
}

const RECENT = 2;
/** The memory of the thread: the latest exchange stays visible, older turns fold away but are never lost. */
function Conversation({ messages }: { messages: Thread['messages'] }) {
  const older = messages.slice(0, -RECENT),
    recent = messages.slice(-RECENT);
  const list = (items: Thread['messages']) => (
    <ChatMessageList density="compact" align="top">
      {items.map(m => (
        <ChatMessage
          key={m.id}
          sender={m.role}
          name={<VisuallyHidden>{m.role === 'user' ? 'Du' : 'Assistenten'}</VisuallyHidden>}
        >
          <ChatMessageBubble
            variant={m.role === 'assistant' ? 'ghost' : 'filled'}
            metadata={
              <ChatMessageMetadata timestamp={<Timestamp value={m.createdAt} format="time" hasTooltip={false} />} />
            }
          >
            {m.body}
          </ChatMessageBubble>
        </ChatMessage>
      ))}
    </ChatMessageList>
  );
  return (
    <Collapsible
      defaultIsOpen={false}
      chevronPosition="start"
      trigger={<Text type="supporting">Historik · {messages.length} meddelanden</Text>}
    >
      <VStack gap={2}>
        {older.length > 0 && list(older)}
        {list(recent)}
      </VStack>
    </Collapsible>
  );
}

/**
 * A thread, not a card: status and source on top, one sentence, the assessment, the proposals drawn in the week,
 * the actions, "varför nu?", and a composer at the bottom so the thread keeps its memory.
 */
export function ThreadCard({ thread, compact, headingLevel = 3, beside = false, onChange }: Props) {
  // The selection is the card's draft (D12): the rows' `selected` flags when the server wrote them, else every proposed time.
  const seed = () => {
    const rows = thread.items.filter(i => i.ref.startsWith('proposal:'));
    return rows.length
      ? rows
          .filter(i => i.selected)
          .map(i => i.ref.slice('proposal:'.length))
          .filter(id => thread.proposals.some(p => p.id === id && p.status === 'proposed'))
      : thread.proposals.filter(p => p.status === 'proposed').map(p => p.id);
  };
  const [selected, setSelected] = useState<string[]>(seed);
  const [why, setWhy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const talk = useConversation();
  // Busy never disables the buttons: a disabled button drops the focus it holds (2.4.3). Action-buttons wait on their own promise.
  const { run, apply, error } = useThreadAction({ onChange });
  const leave = useLeaveWithUndo(apply);
  const snoozeRows = useSnoozeRows({ thread, run, leave });
  // The week the proposals are drawn in, from the same cache as the calendar page; read again whenever a proposal thread changes.
  const week = useQuery({ ...calendarWeekQuery(thread.week ?? ''), enabled: !!thread.week });
  const events = week.data?.events ?? EMPTY_EVENTS;
  const chipRef = 'thread:' + thread.id;
  const inConversation = talk.chipped.includes(chipRef);
  const addItem = {
    id: 'add',
    label: inConversation ? 'I samtalet' : 'Lägg till i samtalet',
    isDisabled: inConversation,
    onClick: () => talk.addChip({ ref: chipRef, kind: 'thread', label: thread.title, threadId: thread.id }),
  };
  const draft = thread.messages.at(-1)?.meta?.draft;
  useEffect(() => {
    setSelected(seed());
  }, [thread.updatedAt, thread.proposals.length]);
  const undoUntil = thread.proposals
    .map(p => p.undoUntil)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const pending = executionStatus(thread.execution);
  const undoOpen =
    !pending && !!undoUntil && Date.parse(undoUntil) > now && thread.proposals.some(p => p.status === 'confirmed');
  useEffect(() => {
    if (!undoOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [undoOpen]);
  const open = !pending && thread.state === 'open' && thread.proposals.some(p => p.status === 'proposed');
  // The obligation (D30): where it stands, who could not be placed, and who has answered.
  const step = obligationStep(thread.proposals),
    sum = replySummary(thread.proposals);
  const unplaced = thread.items.filter(i => i.ref.startsWith('unplaced:'));
  const accepted = thread.proposals.filter(p => p.status === 'accepted'),
    waiting = thread.proposals.filter(p => p.status === 'confirmed' || p.status === 'final');
  const saidNo = thread.proposals.filter(p => p.status === 'declined-by-invitee' || p.status === 'counter');
  const roster = step === 'inbjudningar' || step === 'svar' || step === 'klart';
  const first = thread.messages.find(m => m.role === 'assistant');
  const conversation = thread.kind === 'question' ? thread.messages : thread.messages.filter(m => m !== first);
  const { lead, rest } = split(first?.body ?? thread.title);
  const items = useMemo(() => agendaItems(events, thread.proposals), [events, thread.proposals]);
  const nextWeek = thread.week ? addDays(thread.week, 7) : null;
  const count = selected.length,
    plural = count === 1 ? 'inbjudan' : 'inbjudningar';
  const status = statusLine(thread);
  return (
    <Card
      padding={3}
      variant={thread.state === 'open' && thread.waitingOn ? 'muted' : 'default'}
      elevation={inConversation || (open && !thread.waitingOn) ? 'low' : 'none'}
    >
      <VStack
        gap={2}
        as="article"
        tabIndex={-1}
        aria-label={`Kort: ${thread.title}`}
        id={`${beside ? 'card' : 'thread'}-${thread.id}`}
        aria-current={inConversation ? 'true' : undefined}
      >
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          <HStack gap={2} vAlign="center" wrap="wrap">
            {status.badge ? (
              <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label={status.label} />
            ) : (
              <Text type="supporting" weight="semibold">
                {status.label}
              </Text>
            )}
            {draft && open && <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />}
          </HStack>
          <Text type="supporting">
            {thread.state === 'open' && thread.waitingOn ? `Väntar på ${thread.waitingOn} · ` : ''}
            {thread.trigger.source} · <Timestamp value={thread.trigger.at} format="time" hasTooltip={false} />
          </Text>
        </HStack>
        {thread.kind === 'pushed' && (
          <>
            <Heading level={3} accessibilityLevel={headingLevel} weight="medium">
              {lead}
            </Heading>
            {rest && (
              <Text as="p" color="secondary">
                {rest}
              </Text>
            )}
          </>
        )}
        {thread.kind === 'pushed' && thread.proposals.length > 0 && (
          <Stepper
            label="Steg"
            activeStep={obligationSteps.indexOf(step)}
            density="compact"
            horizontalOptions={{ minimumStepWidth: 124, collapsedVariant: 'withLabel' }}
          >
            {obligationSteps.map((s, i) => (
              <Step
                key={s}
                step={i}
                label={stepLabel[s]}
                description={
                  s === 'forslag'
                    ? `${thread.proposals.length} ritade`
                    : s === 'svar'
                      ? sum.total
                        ? `${sum.accepted + sum.declined} av ${sum.total} svarat`
                        : ''
                      : s === 'klart'
                        ? step === 'klart'
                          ? 'alla har svarat'
                          : ''
                        : sum.total
                          ? `${sum.total} skickade`
                          : ''
                }
              />
            ))}
          </Stepper>
        )}
        {/* The judgement calls (D30): whoever got no slot is a row with a reason, next to the week that could not hold them. */}
        {open && unplaced.length > 0 && (
          <HStack gap={1} vAlign="center" wrap="wrap" role="group" aria-label={`Oplacerade: ${unplaced.length}`}>
            <Text type="supporting" weight="semibold">
              Oplacerade · {unplaced.length}
            </Text>
            {unplaced.map(u => (
              <Text key={u.ref} type="supporting">
                {u.label} · {u.detail}
              </Text>
            ))}
          </HStack>
        )}
        {/* The replies (D30): the Stepper above holds the sum; here are the people, where they are needed. */}
        {roster && (
          <VStack gap={2} as="section" aria-label="Svar">
            {sum.declined > 0 && (
              <Text weight="semibold">{sum.declined === 1 ? 'En' : sum.declined} vill ha en annan tid.</Text>
            )}
            {accepted.length > 0 && (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting" weight="semibold">
                  Accepterat · {accepted.length}
                </Text>
                <AvatarGroup size="sm">
                  {accepted.slice(0, 5).map(p => (
                    <Avatar key={p.id} name={p.participant.name} />
                  ))}
                  {accepted.length > 5 && <AvatarGroupOverflow count={accepted.length - 5} />}
                </AvatarGroup>
                <Text type="supporting">{accepted.map(p => p.participant.name.split(' ')[0]).join(', ')}</Text>
              </HStack>
            )}
            {waiting.length > 0 && (
              <List density="compact" hasDividers aria-label={`Väntar: ${waiting.length}`}>
                {waiting.map(p => (
                  <ListItem
                    key={p.id}
                    label={<Text>{p.participant.name}</Text>}
                    description={
                      <Text type="supporting">{`${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)}`}</Text>
                    }
                    endContent={
                      <Text type="supporting">
                        {p.reminders
                          ? `påmind ${p.reminders === 1 ? 'en gång' : `${p.reminders} gånger`}`
                          : 'väntar på svar'}
                      </Text>
                    }
                  />
                ))}
              </List>
            )}
          </VStack>
        )}
        {thread.proposals.length > 0 &&
          thread.week &&
          !(roster && !open) &&
          (compact ? (
            <CheckboxList
              label="Förslag"
              isLabelHidden
              value={selected}
              onChange={setSelected}
              isReadOnly={!open}
              density="compact"
            >
              {thread.proposals
                .filter(p => p.status !== 'declined')
                .map(p => (
                  <CheckboxListItem
                    key={p.id}
                    value={p.id}
                    label={
                      <Text>{`${p.participant.name} · ${shortDayLabel(p.start.slice(0, 10))} ${timeRange(p.start, p.end)}`}</Text>
                    }
                    isChecked={p.status !== 'proposed' || selected.includes(p.id)}
                    isDisabled={p.status !== 'proposed'}
                  />
                ))}
            </CheckboxList>
          ) : (
            <WeekAgenda
              week={thread.week}
              days={5}
              items={items}
              label={`Vecka ${weekNumber(thread.week)} med förslagen`}
            />
          ))}
        {conversation.length > 0 && <Conversation messages={conversation} />}
        {error && (
          <Text as="p" role="alert" color="accent">
            {error}
          </Text>
        )}
        {pending && (
          <HStack gap={2} wrap="wrap">
            <Text role="status">{pending}</Text>
            <Button label="Kontrollera status" clickAction={() => run(() => api.checkExecution(thread.id))} />
          </HStack>
        )}
        {roster && !pending && !open && thread.state === 'open' && !undoOpen && (
          <HStack gap={2} wrap="wrap">
            {waiting.length > 0 && (
              <Button
                variant="secondary"
                label={
                  waiting.length === 1 ? 'Påminn den som inte svarat' : `Påminn de ${waiting.length} som inte svarat`
                }
                clickAction={() => run(() => api.remindInvitees(thread.id))}
              />
            )}
            {!thread.waitingOn && <TimePicker label="Inte nu" size="md" rows={snoozeRows.rows} own={snoozeRows.own} />}
            <MoreMenu
              label="Fler val"
              size="sm"
              variant="ghost"
              items={[addItem, { id: 'why', label: 'Varför ser jag detta?', onClick: () => setWhy(v => !v) }]}
            />
          </HStack>
        )}
        {(open || undoOpen) && (
          <HStack gap={2} wrap="wrap">
            {open && (
              <Button
                variant="secondary"
                label={`Skicka ${count} ${plural}`}
                isDisabled={!count}
                clickAction={() => run(() => api.confirm(thread.id, selected))}
              />
            )}
            {open && !compact && (
              <Button label="Justera i kalendern" href={`/calendar?date=${thread.week}&view=week`} />
            )}
            {open && compact && <Button label="Visa i veckan" href={`/calendar?date=${thread.week}&view=week`} />}
            {open && nextWeek && (
              <Button
                label={`Vecka ${weekNumber(nextWeek)} i stället`}
                clickAction={() => run(() => api.replan(thread.id, nextWeek))}
              />
            )}
            {open && <TimePicker label="Inte nu" size="md" rows={snoozeRows.rows} own={snoozeRows.own} />}
            {open && (
              <MoreMenu
                label="Fler val"
                size="sm"
                variant="ghost"
                items={[
                  addItem,
                  {
                    id: 'dismiss',
                    label: 'Avfärda · inte aktuellt',
                    onClick: () =>
                      void run(async () => {
                        const t = await api.dismiss(thread.id);
                        leave(
                          t,
                          'Avfärdad som inte aktuellt. Förslagen ligger kvar under Redan hanterat i tio minuter.',
                        );
                        return t;
                      }),
                  },
                  { id: 'why', label: 'Varför ser jag detta?', onClick: () => setWhy(v => !v) },
                ]}
              />
            )}
            {undoOpen && undoUntil && (
              <Button
                variant="destructive"
                label={`Ångra allt · ${Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 60000))} min kvar`}
                clickAction={() => run(() => api.undo(thread.id))}
              />
            )}
          </HStack>
        )}
        {snoozeRows.dialog}
        {draft && open && (
          <Text type="supporting" as="p">
            Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.
          </Text>
        )}
        {thread.kind === 'pushed' && (why || !open) && (
          <Text type="supporting" as="p">
            Varför nu? {thread.trigger.reason}.{' '}
            {open ? 'Skickas via kalendern med möjlighet att ångra i 10 minuter.' : ''}
          </Text>
        )}
      </VStack>
    </Card>
  );
}
