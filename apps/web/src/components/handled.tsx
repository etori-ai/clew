import { useState } from 'react';
import { useLocation } from 'react-router';
import type { Thread } from '@clew/contracts';
import {
  AreaLine,
  Button,
  DropdownMenu,
  Heading,
  HStack,
  Icon,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  VStack,
} from '@clew/ui';
import { api } from '../api';
import { useThreadAction } from '../mutations';
import { useMarks } from '../marks';
import { canUndoReceipt } from '../receipt-state';
import { reviewOverCard, withCard } from '../panel-address';

type Period = 'idag' | 'veckan' | 'allt';
type Kind = 'alla' | 'hanterade' | 'avfardade' | 'fragor';
/** When and what are two questions, so they are two choices: one row of five mixed the two and could not ask for this week's questions. */
const periods: { value: Period; label: string }[] = [
  { value: 'idag', label: 'I dag' },
  { value: 'veckan', label: 'Veckan' },
  { value: 'allt', label: 'Allt' },
];
const kinds: { value: Kind; label: string }[] = [
  { value: 'alla', label: 'Alla' },
  { value: 'hanterade', label: 'Hanterade' },
  { value: 'avfardade', label: 'Avfärdade' },
  { value: 'fragor', label: 'Frågor' },
];
const dayKey = (iso: string) => iso.slice(0, 10);
const dayHeading = (key: string) =>
  new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(key + 'T12:00:00'),
  );
const when = (t: Thread) => t.handledAt ?? t.updatedAt;

type RowProps = {
  thread: Thread;
  now: number;
  onChange: (thread: Thread) => void;
  conversationHref: (threadId: string) => string;
};
/** One row of the log with its one way back: Ångra while the window is open, Återöppna on a dismissed card. Its error sits under the row. */
function HandledRow({ thread: t, now, onChange, conversationHref }: RowProps) {
  const { run, error } = useThreadAction({ onChange });
  // The row opens its card beside Klart, and a reviewed card's review over it (D80, D107 rule 5): the tab is kept, so
  // closing either leaves Klart as it was.
  const { pathname, search } = useLocation();
  const mark = useMarks().ofThread(t);
  const last = [...t.messages].reverse().find(m => m.role === 'assistant');
  const undoUntil = t.proposals
    .map(p => p.undoUntil)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > now && t.proposals.some(p => p.status === 'confirmed');
  const receiptUndo = canUndoReceipt(t, now);
  const reopenable = t.state === 'dismissed' && !!t.handledAt && now - Date.parse(t.handledAt) <= 10 * 60_000;
  const question = t.kind === 'question';
  const icon = question ? (
    <Icon icon="search" color="secondary" />
  ) : t.state === 'dismissed' ? (
    <Icon icon="close" color="secondary" />
  ) : (
    <Icon icon="check" color="success" />
  );
  const end = undoOpen ? (
    <Button size="sm" label="Ångra" clickAction={() => run(() => api.undo(t.id))} />
  ) : receiptUndo ? (
    <Button size="sm" label="Ångra" clickAction={() => run(() => api.undoReceipt(t.id))} />
  ) : reopenable ? (
    <Button size="sm" label="Återöppna" clickAction={() => run(() => api.reopen(t.id))} />
  ) : (
    <Text type="supporting">{t.state === 'dismissed' ? 'Avfärdad' : question ? 'Fråga' : 'Klart'}</Text>
  );
  const at = new Date(when(t)).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
  // A decision's row carries what was done and what the source answered (D70): the receipt's headline and the time it came.
  const line = t.receipt
    ? `${t.receipt.headline.replace(/\.$/, '')} · ${t.trigger.source} svarade ${new Date(t.receipt.at).toLocaleTimeString('sv-SE', { timeStyle: 'short' })}`
    : (last?.body ?? t.trigger.reason);
  // The time leads the line, so the times stand under each other whatever the button at the end of the row is called.
  return (
    <ListItem
      startContent={icon}
      align="start"
      label={<Text weight="semibold">{question ? `Fråga: ${t.title}` : t.title}</Text>}
      description={
        <VStack gap={0}>
          {/* The row's meta line (D71): the area's glyph first, the time leading the words. */}
          <AreaLine icon={question ? undefined : mark.icon}>
            {at} · {question ? line : `${mark.title} · ${line}`}
          </AreaLine>
          {error && (
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          )}
        </VStack>
      }
      href={
        question
          ? conversationHref(t.id)
          : t.actions.some(a => a.review === 'each')
            ? reviewOverCard(pathname, search, t.id)
            : withCard(pathname, search, t.id)
      }
      endContent={end}
    />
  );
}

/**
 * Redan hanterat: the person's own log. Decisions, dismissals, undos and questions grouped by day, filterable, with
 * Ångra while the window is open, Återöppna on dismissed cards and the conversation reopening from a Fråga row.
 */
export function Handled({
  threads,
  compact,
  onChange,
  conversationHref,
}: {
  threads: Thread[];
  compact: boolean;
  onChange: (thread: Thread) => void;
  conversationHref: (threadId: string) => string;
}) {
  const [period, setPeriod] = useState<Period>('idag');
  const [kind, setKind] = useState<Kind>('alla');
  const now = Date.now();
  const inPeriod = (t: Thread) =>
    period === 'allt' ||
    (period === 'idag'
      ? dayKey(when(t)) === dayKey(new Date().toISOString())
      : now - Date.parse(when(t)) < 7 * 86400_000);
  const ofKind = (t: Thread) =>
    kind === 'alla' ||
    (kind === 'hanterade'
      ? t.state === 'handled'
      : kind === 'avfardade'
        ? t.state === 'dismissed'
        : t.kind === 'question');
  const keep = (t: Thread) => inPeriod(t) && ofKind(t);
  const shown = threads.filter(keep).sort((a, b) => when(b).localeCompare(when(a)));
  const days = [...new Set(shown.map(t => dayKey(when(t))))];
  return (
    <VStack gap={3} as="section" aria-label="Redan hanterat">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Heading level={3} accessibilityLevel={2}>
          Redan hanterat
        </Heading>
        {/* The two choices do not fit a phone side by side and SegmentedControl truncates them; there each is one menu (1.4.10). */}
        {compact ? (
          <HStack gap={2} wrap="wrap">
            <DropdownMenu
              presentation="adaptive"
              button={{
                label: `Tid: ${periods.find(p => p.value === period)!.label}`,
                size: 'sm',
                variant: 'secondary',
              }}
              items={periods.map(p => ({ id: p.value, label: p.label, onClick: () => setPeriod(p.value) }))}
            />
            <DropdownMenu
              presentation="adaptive"
              button={{ label: `Visa: ${kinds.find(k => k.value === kind)!.label}`, size: 'sm', variant: 'secondary' }}
              items={kinds.map(k => ({ id: k.value, label: k.label, onClick: () => setKind(k.value) }))}
            />
          </HStack>
        ) : (
          <HStack gap={2} wrap="wrap">
            <SegmentedControl label="Tid" size="sm" value={period} onChange={v => setPeriod(v as Period)}>
              {periods.map(p => (
                <SegmentedControlItem key={p.value} value={p.value} label={p.label} />
              ))}
            </SegmentedControl>
            <SegmentedControl label="Typ" size="sm" value={kind} onChange={v => setKind(v as Kind)}>
              {kinds.map(k => (
                <SegmentedControlItem key={k.value} value={k.value} label={k.label} />
              ))}
            </SegmentedControl>
          </HStack>
        )}
      </HStack>
      {!shown.length && (
        <Text type="supporting">
          {period === 'idag' && kind === 'alla' ? 'Inget hanterat i dag ännu.' : 'Inget som stämmer med valet.'}
        </Text>
      )}
      {days.map(day => (
        <List
          key={day}
          hasDividers
          density="compact"
          header={
            <Text weight="semibold" type="supporting">
              {dayHeading(day)}
            </Text>
          }
        >
          {shown
            .filter(t => dayKey(when(t)) === day)
            .map(t => (
              <HandledRow key={t.id} thread={t} now={now} onChange={onChange} conversationHref={conversationHref} />
            ))}
        </List>
      ))}
    </VStack>
  );
}
