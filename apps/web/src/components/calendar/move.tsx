import { invalidateCalendar } from '../../thread-cache';
import { useState, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import {
  Button,
  DateInput,
  FormLayout,
  MetadataList,
  MetadataListItem,
  Text,
  TimeInput,
  VStack,
  useAnnounce,
  type AgendaItem,
} from '@clew/ui';
import { dayLabel, displayDate, shortDayLabel, timeRange } from '@clew/calendar/dates';
import { api } from '../../api';
import { useThreadAction } from '../../mutations';
import { fieldsOf, instantOf } from './booking';

const minutes = (item: { start: string; end: string }) =>
  Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60000);
const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);

/**
 * "Flytta …" as the page holds it (2026-11-18): the entry being moved and the time the fields say, so the pane beside
 * the grid draws the fields while the grid draws the entry's own block at that time and lets it be dragged. A meeting of
 * one's own can be stretched as well; a proposal keeps its length, so only its start moves. The decision is the one the
 * entry's dialog made before (`rescheduleEvent`, `moveProposal`), written only by "Spara".
 */
export function useMove() {
  const client = useQueryClient();
  const announce = useAnnounce();
  const { run, error, reset } = useThreadAction();
  const [moving, setMoving] = useState<{
    item: AgendaItem;
    decisionId: string;
    day: string;
    from: string;
    to: string;
  } | null>(null);
  const item = moving?.item ?? null;
  const proposal = item?.proposal;
  const event = item?.event;
  const startAt = moving ? instantOf(moving.day, moving.from) : null;
  const endAt =
    moving && startAt
      ? proposal
        ? new Date(Date.parse(startAt) + minutes(moving.item) * 60000).toISOString()
        : instantOf(moving.day, moving.to)
      : null;
  const endFirst = !!startAt && !!endAt && Date.parse(endAt) <= Date.parse(startAt);
  const span = startAt && endAt && !endFirst ? { start: startAt, end: endAt } : null;
  const close = () => {
    setMoving(null);
    reset();
  };
  /** Every change goes through the cache (D33): a moved proposal's thread is written in by `run`; an own booking's change reads the loaded weeks again. */
  const save = () => {
    if (!moving || !span) return;
    const act = (action: () => Promise<Thread | void>, said: string) =>
      run(async () => {
        const thread = await action();
        if (!thread) void invalidateCalendar(client);
        announce(said);
        setMoving(null);
        return thread;
      });
    if (proposal)
      return act(
        () => api.moveProposal(proposal.threadId, proposal.id, span),
        `Förslaget ligger nu ${shortDayLabel(displayDate(span.start))} ${timeRange(span.start, span.end)}.`,
      );
    if (event)
      return act(
        () => api.rescheduleEvent({ decisionId: moving.decisionId, ref: event.ref, revision: event.revision, ...span }),
        'Beslutet att flytta mötet är sparat. Ärendet visar kalenderns besked.',
      );
  };
  return {
    moving,
    item,
    span,
    endFirst,
    error,
    start: (entry: AgendaItem) => {
      reset();
      setMoving({ item: entry, decisionId: crypto.randomUUID(), ...fieldsOf(entry) });
    },
    patch: (next: { day?: string; from?: string; to?: string }) => setMoving(m => (m ? { ...m, ...next } : m)),
    /** The grid moved or stretched the block: the fields follow. */
    setSpan: (at: { start: string; end: string }) => setMoving(m => (m ? { ...m, ...fieldsOf(at) } : m)),
    close,
    save,
  };
}
export type Move = ReturnType<typeof useMove>;

/**
 * The move's fields (board "Flytta i samma ruta"): the time the entry has now, then the day and the clocks it is moved
 * to. A proposal has no end to set: a samtal keeps its length. `dayRef` is the field that takes the focus.
 */
export function MoveFields({ move, dayRef }: { move: Move; dayRef?: Ref<HTMLInputElement> }) {
  const { moving } = move;
  if (!moving) return null;
  const { item } = moving;
  const now = `${capital(dayLabel(displayDate(item.start)))} ${timeRange(item.start, item.end)}`;
  return (
    <VStack gap={6}>
      <MetadataList columns="single">
        <MetadataListItem label="Tid nu">
          <Text>{now}</Text>
        </MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        <FormLayout direction="vertical" defaultOptionality="required">
          <DateInput
            ref={dayRef}
            data-autofocus=""
            label="Dag"
            value={moving.day as never}
            onChange={day => move.patch({ day: day ?? '' })}
            isRequired
            weekStartsOn="mon"
          />
          {item.proposal ? (
            <TimeInput
              label="Börjar"
              value={moving.from as never}
              onChange={from => move.patch({ from: from ?? '' })}
              isRequired
              increment={15}
            />
          ) : (
            <FormLayout direction="horizontal" defaultOptionality="required">
              <TimeInput
                label="Börjar"
                value={moving.from as never}
                onChange={from => move.patch({ from: from ?? '' })}
                isRequired
                increment={15}
              />
              <TimeInput
                label="Slutar"
                value={moving.to as never}
                onChange={to => move.patch({ to: to ?? '' })}
                isRequired
                increment={15}
                status={
                  move.endFirst ? { type: 'error', message: 'Sluttiden måste vara efter starttiden.' } : undefined
                }
              />
            </FormLayout>
          )}
        </FormLayout>
        {item.proposal && <Text type="supporting">Samtalet är {minutes(item)} minuter och behåller sin längd.</Text>}
      </VStack>
    </VStack>
  );
}

/** The form's two buttons: let go of the move, or save the new time. */
export function MoveButtons({ move }: { move: Move }) {
  return (
    <>
      <Button size="sm" variant="ghost" label="Avbryt" onClick={move.close} />
      <Button size="sm" variant="primary" label="Spara" isDisabled={!move.span} clickAction={move.save} />
    </>
  );
}
