import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import {
  Banner,
  Button,
  DateTimeInput,
  DayStrip,
  Dialog,
  DialogHeader,
  MetadataList,
  MetadataListItem,
  Text,
  TimeInput,
  VStack,
  useAnnounce,
  useMediaQuery,
  type AgendaItem,
} from '@clew/ui';
import { dayLabel, displayDate, localClock, localInstant, shortDayLabel, timeRange } from '@clew/calendar/dates';
import { api } from '../../api';
import { useThreadAction } from '../../mutations';
import { keys } from '../../query-keys';
import { mobileQuery } from '../shell';
import { AddToConversation } from '../add-to-conversation';
import { useConversation } from '../conversation-context';
import { DialogFrame } from '../dialog-frame';

type Mode = 'view' | 'move' | 'cancel';
type Props = {
  item: AgendaItem | null;
  /** Everything on the item's day, for the strip above the details (the "day around it", D9). */
  dayItems: AgendaItem[];
  onClose: () => void;
  /** The calendar changed and the cache already knows (D33): the host is told for what it alone shows, such as the panel's day view. A thread comes back when a proposal moved. */
  onChanged?: (thread?: Thread) => void;
  onOpenDay?: (date: string) => void;
  onAddChip?: (item: AgendaItem) => void;
};
const kindLabel = { event: 'Bokat', proposal: 'Förslag', booked: 'Bokat samtal', gap: 'Ledigt' } as const;
const minutes = (item: { start: string; end: string }) =>
  Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60000);
const hhmm = (instant: string) => localClock(instant).slice(11, 16);

/**
 * An entry opened from the calendar (D32): the day around it, its details, and what the person may do with it. An own
 * booking can be moved or cancelled; a drawn proposal can be moved, which is the keyboard path to what drag does (D27 §4).
 * Cancelling confirms inline, never in a second dialog. Everything else is read-only. The day and the details scroll
 * between the title and the actions (`DialogFrame`), so a low window never cuts the actions off.
 */
export function EventDialog({ item, dayItems, onClose, onChanged, onOpenDay, onAddChip }: Props) {
  const mobile = useMediaQuery(mobileQuery);
  const announce = useAnnounce();
  const { hasBox } = useConversation();
  const [mode, setMode] = useState<Mode>('view');
  const [decisionId, setDecisionId] = useState(() => crypto.randomUUID());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const client = useQueryClient();
  const { run, error, reset } = useThreadAction();
  useEffect(() => {
    setDecisionId(crypto.randomUUID());
    setMode('view');
    reset();
    if (item) {
      setStart(localClock(item.start));
      setEnd(hhmm(item.end));
    }
  }, [item?.id]);
  const startField = useRef<HTMLInputElement>(null);
  const cancelNote = useRef<HTMLDivElement>(null);
  // What a choice opens sits under the day, which a low window scrolls out of sight: the new time takes focus and the
  // question is brought into view.
  useEffect(() => {
    if (mode === 'move') startField.current?.focus();
    if (mode === 'cancel') cancelNote.current?.scrollIntoView({ block: 'nearest' });
  }, [mode]);
  if (!item)
    return (
      <Dialog isOpen={false} onOpenChange={onClose}>
        <DialogHeader title="Möte" />
      </Dialog>
    );
  const event = item.event,
    proposal = item.proposal;
  const day = displayDate(item.start);
  const own = !!event && event.mine && event.canCancel && !event.recurring && !event.allDay;
  const movable = own || (!!proposal && proposal.status === 'proposed');
  const newStart = start ? localInstant(start) : null;
  const newEnd = newStart
    ? proposal
      ? new Date(Date.parse(newStart) + minutes(item) * 60000).toISOString()
      : localInstant(`${start.slice(0, 10)}T${end}`)
    : null;
  const endFirst = !!newStart && !!newEnd && Date.parse(newEnd) <= Date.parse(newStart);
  /** Every change goes through the cache (D33): a moved proposal's thread is written in by `run`; an own booking's change reads the loaded weeks again. */
  const act = (action: () => Promise<Thread | void>, said: string) =>
    run(async () => {
      const thread = await action();
      if (!thread) void client.invalidateQueries({ queryKey: keys.calendarAll });
      announce(said);
      onChanged?.(thread ?? undefined);
      onClose();
      return thread;
    });
  const save = () => {
    if (!newStart || !newEnd || endFirst) return;
    if (proposal)
      return act(
        () => api.moveProposal(proposal.threadId, proposal.id, { start: newStart, end: newEnd }),
        `Förslaget ligger nu ${shortDayLabel(displayDate(newStart))} ${timeRange(newStart, newEnd)}.`,
      );
    if (event)
      return act(
        () =>
          api.rescheduleEvent({ decisionId, ref: event.ref, revision: event.revision, start: newStart, end: newEnd }),
        'Beslutet att flytta mötet är sparat. Kortet visar kalenderns besked.',
      );
  };
  const cancel = () => {
    if (event)
      void act(
        () => api.cancelEvent({ decisionId, ref: event.ref, revision: event.revision }),
        'Beslutet att ställa in mötet är sparat. Kortet visar kalenderns besked.',
      );
  };
  const when = item.allDay ? `${dayLabel(day)}, hela dagen` : `${dayLabel(day)} ${timeRange(item.start, item.end)}`;
  return (
    <Dialog
      isOpen
      onOpenChange={open => {
        if (!open) onClose();
      }}
      width={520}
      purpose={mode === 'view' ? 'info' : 'form'}
    >
      <DialogFrame
        header={
          <DialogHeader
            title={item.title}
            subtitle={when}
            onOpenChange={open => {
              if (!open) onClose();
            }}
          />
        }
        error={error}
        scrollLabel={mobile ? 'Uppgifterna' : 'Dagen och uppgifterna'}
        primary={
          <>
            {mode === 'view' && (
              <>
                {onOpenDay && (
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Visa dagen"
                    onClick={() => {
                      onClose();
                      onOpenDay(day);
                    }}
                  />
                )}
                {/* Only where the page has a question box (D107 rule 6): Kalender has none. */}
                {onAddChip && hasBox && (
                  <AddToConversation
                    onAdd={() => {
                      onAddChip(item);
                      onClose();
                    }}
                  />
                )}
                {own && <Button size="sm" variant="secondary" label="Ställ in" onClick={() => setMode('cancel')} />}
                {movable && (
                  <Button
                    size="sm"
                    variant="primary"
                    label={proposal ? 'Flytta förslaget' : 'Flytta'}
                    onClick={() => setMode('move')}
                  />
                )}
              </>
            )}
            {mode === 'move' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Avbryt"
                  onClick={() => {
                    setMode('view');
                    reset();
                  }}
                />
                <Button
                  size="sm"
                  variant="primary"
                  label="Spara"
                  isDisabled={!newStart || endFirst}
                  clickAction={save}
                />
              </>
            )}
            {mode === 'cancel' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Avbryt"
                  onClick={() => {
                    setMode('view');
                    reset();
                  }}
                />
                <Button size="sm" variant="destructive" label="Ja, ställ in" clickAction={cancel} />
              </>
            )}
          </>
        }
      >
        <VStack gap={3}>
          {!mobile && (
            <DayStrip
              date={day}
              items={dayItems}
              selectedId={item.id}
              dayHeadingLevel={3}
              accessiblePath="Uppgifterna står under dagen."
            />
          )}
          <MetadataList>
            <MetadataListItem label="Tid">{when}</MetadataListItem>
            <MetadataListItem label="Typ">{kindLabel[item.kind]}</MetadataListItem>
            {event?.room && <MetadataListItem label="Rum">{event.room}</MetadataListItem>}
            {event && event.participants.length > 0 && (
              <MetadataListItem label="Deltagare">{event.participants.join(', ')}</MetadataListItem>
            )}
            {event && <MetadataListItem label="Arrangör">{event.organizer}</MetadataListItem>}
            {proposal && <MetadataListItem label="Medarbetare">{proposal.participant.name}</MetadataListItem>}
          </MetadataList>
          {mode === 'move' && (
            <VStack gap={2} as="section" aria-label="Ny tid">
              <DateTimeInput
                ref={startField}
                label={proposal ? 'Ny starttid' : 'Börjar'}
                value={start as never}
                onChange={v => setStart(v ?? '')}
                isRequired
                weekStartsOn="mon"
                timeIncrement={15}
                presentation="adaptive-bottom-sheet"
              />
              {proposal ? (
                <Text type="supporting">Samtalet är {minutes(item)} minuter och behåller sin längd.</Text>
              ) : (
                <TimeInput
                  label="Slutar"
                  value={end as never}
                  onChange={v => setEnd(v ?? '')}
                  isRequired
                  increment={15}
                  status={endFirst ? { type: 'error', message: 'Sluttiden måste vara efter starttiden.' } : undefined}
                />
              )}
            </VStack>
          )}
          {mode === 'cancel' && (
            <Banner
              ref={cancelNote}
              status="warning"
              title="Ställ in mötet?"
              description="Mötet tas bort ur din kalender och ur deltagarnas."
              collapsible={false}
            />
          )}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}
