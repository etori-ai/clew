import { useEffect, useMemo, useState, type Ref } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityInput, AvailabilityState, CalendarMember, CalendarRoom } from '@clew/contracts';
import {
  Banner,
  Button,
  DateInput,
  FormLayout,
  HStack,
  Heading,
  List,
  ListItem,
  MultiSelector,
  Selector,
  StatusDot,
  Text,
  TextInput,
  TimeInput,
  VStack,
  useAnnounce,
  useToast,
} from '@clew/ui';
import { localClock, localInstant } from '@clew/calendar/dates';
import { api } from '../../api';
import { availabilityQuery, membersQuery, roomsQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { keys } from '../../query-keys';
import { applyThread } from '../../thread-cache';

const EMPTY_MEMBERS: CalendarMember[] = [];
const EMPTY_ROOMS: CalendarRoom[] = [];
const stateWord: Record<AvailabilityState, string> = { free: 'ledig', busy: 'upptagen', unknown: 'okänt' };
const stateDot = { free: 'success', busy: 'warning', unknown: 'neutral' } as const;
/** A room is "ledigt": the word follows what it is said of. */
const roomWord: Record<AvailabilityState, string> = { free: 'ledigt', busy: 'upptaget', unknown: 'okänt' };

/** A local day and clock as an instant, or nothing while a field is empty or names a time that does not exist. */
export const instantOf = (day: string, clock: string) => {
  if (!day || !clock) return null;
  try {
    return localInstant(`${day}T${clock}`);
  } catch {
    return null;
  }
};
/** A span as the form's three fields say it: the day, and the two clocks on it. */
export const fieldsOf = (span: { start: string; end: string }) => ({
  day: localClock(span.start).slice(0, 10),
  from: localClock(span.start).slice(11, 16),
  to: localClock(span.end).slice(11, 16),
});
/** A value that has stood still for a moment, so a time being dragged or typed is asked about once. */
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** A booking being made: what the form holds. Nothing of it is written before "Boka". */
export interface BookingDraft {
  decisionId: string;
  title: string;
  /** The day and the two clocks as the fields hold them, so a time half typed is kept as typed. */
  day: string;
  from: string;
  to: string;
  participants: string[];
  room: string;
}

/**
 * "Ny bokning" as the page holds it (2026-11-18): one draft, kept by the page so that the pane beside the grid, the
 * drawer and a phone's dialog all draw the same form, and so the draft outlives another entry standing in the pane for
 * a moment. The grid draws the draft's span as a block and moves it (`setSpan`); the fields are the keyboard path to the
 * same time (D27). The availability of the person, the guests and the room is read by itself whenever the time or the
 * guests change. Nothing is written before `book`.
 */
export function useBooking() {
  const client = useQueryClient();
  const toast = useToast();
  const announce = useAnnounce();
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; uncertain: boolean } | null>(null);
  const isOpen = !!draft;
  // The unit's members and the rooms come from the cache and are kept a while (D33), so the form opens with them.
  const members = useQuery({ ...membersQuery, enabled: isOpen }).data?.members ?? EMPTY_MEMBERS;
  const rooms = useQuery({ ...roomsQuery, enabled: isOpen }).data?.rooms ?? EMPTY_ROOMS;
  const startAt = draft ? instantOf(draft.day, draft.from) : null;
  const endAt = draft ? instantOf(draft.day, draft.to) : null;
  const endFirst = !!startAt && !!endAt && Date.parse(endAt) <= Date.parse(startAt);
  const valid = !!startAt && !!endAt && !endFirst;
  const ready = valid && !!draft?.title.trim();
  /** The span the grid draws and the calendar is asked about: only a time that can be booked. */
  const span = useMemo(
    () => (valid ? { start: startAt!, end: endAt! } : null),
    // The instants are strings: the span is the same object while they say the same time.
    [valid, startAt, endAt],
  );
  const participants = draft?.participants;
  const room = draft?.room;
  const asked = useMemo<AvailabilityInput | null>(
    () => (span && participants ? { ...span, participants, ...(room ? { room } : {}) } : null),
    [span, participants, room],
  );
  const settled = useSettled(asked, 400);
  const read = useQuery(availabilityQuery(settled));
  // Only the answer about the time now in the form is shown: an answer about the time before it would mislead.
  const current = settled !== null && settled === asked;
  const availability = current ? (read.data ?? null) : null;
  useEffect(() => {
    if (!availability) return;
    announce(
      `Du är ${stateWord[availability.mine]}. ${availability.participants.map(p => `${p.name} ${stateWord[p.state]}`).join(', ')}${availability.room ? `. Rummet ${availability.room.name} ${roomWord[availability.room.state]}` : ''}.`,
    );
  }, [availability, announce]);

  const start = (at: { start: string; end: string }) => {
    setError(null);
    setDraft({ decisionId: crypto.randomUUID(), title: '', ...fieldsOf(at), participants: [], room: '' });
  };
  const patch = (next: Partial<BookingDraft>) => setDraft(d => (d ? { ...d, ...next } : d));
  const close = () => {
    setDraft(null);
    setError(null);
  };
  const book = async () => {
    if (!draft || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const thread = await api.createEvent({
        decisionId: draft.decisionId,
        title: draft.title.trim(),
        start: startAt!,
        end: endAt!,
        participants: draft.participants,
        ...(draft.room ? { room: draft.room } : {}),
      });
      await applyThread(client, thread);
      void client.invalidateQueries({ queryKey: keys.calendarAll });
      toast({
        body: 'Bokningsbeslutet är sparat. Ärendet visar när kalendern har bekräftat bokningen.',
        uniqueID: 'booking:' + thread.id,
      });
      close();
    } catch (e) {
      const text = errorMessage(e, 'Något gick fel.');
      setError({ text, uncertain: /osäker/.test(text) });
    } finally {
      setBusy(false);
    }
  };
  return {
    draft,
    members,
    rooms,
    span,
    endFirst,
    ready,
    availability,
    /** The availability is being read for the time now in the form. */
    reading: !!asked && (!current || read.isFetching),
    unread: current && read.isError,
    error,
    start,
    patch,
    /** The grid moved or stretched the block: the fields follow. */
    setSpan: (at: { start: string; end: string }) => patch(fieldsOf(at)),
    close,
    book,
  };
}
export type Booking = ReturnType<typeof useBooking>;

/** One state of the availability list: the word beside its dot, so the colour never says it alone (1.4.1). */
function State({ state, word }: { state: AvailabilityState; word: string }) {
  return (
    <HStack gap={2} vAlign="center">
      <Text type="supporting" color="secondary">
        {word}
      </Text>
      <StatusDot variant={stateDot[state]} label={word} />
    </HStack>
  );
}

/**
 * The booking's fields (board "Ny bokning i rutan bredvid", 2026-11-18): a title, the day, the two clocks side by side,
 * guests from the unit and a room, and under them who is free at that time. The same fields in the pane beside the
 * grid, in the drawer and in a phone's dialog. `titleRef` is the field that takes the focus when the form opens.
 */
export function BookingFields({ booking, titleRef }: { booking: Booking; titleRef?: Ref<HTMLInputElement> }) {
  const { draft, members, rooms, availability, error } = booking;
  if (!draft) return null;
  return (
    <VStack gap={6}>
      <FormLayout direction="vertical" defaultOptionality="required">
        <TextInput
          ref={titleRef}
          // The form's first field takes the focus where the form opens: Astryx marks it for the drawer and the dialog.
          hasAutoFocus
          label="Rubrik"
          value={draft.title}
          onChange={title => booking.patch({ title })}
          isRequired
          placeholder="Vad handlar mötet om?"
        />
        <DateInput
          label="Dag"
          value={draft.day as never}
          onChange={day => booking.patch({ day: day ?? '' })}
          isRequired
          weekStartsOn="mon"
        />
        <FormLayout direction="horizontal" defaultOptionality="required">
          <TimeInput
            label="Börjar"
            value={draft.from as never}
            onChange={from => booking.patch({ from: from ?? '' })}
            isRequired
            increment={15}
          />
          <TimeInput
            label="Slutar"
            value={draft.to as never}
            onChange={to => booking.patch({ to: to ?? '' })}
            isRequired
            increment={15}
            status={booking.endFirst ? { type: 'error', message: 'Sluttiden måste vara efter starttiden.' } : undefined}
          />
        </FormLayout>
        <MultiSelector
          label="Deltagare"
          isOptional
          options={members.map(m => ({ value: m.email, label: m.name }))}
          value={draft.participants}
          onChange={v => booking.patch({ participants: v.slice(0, 8) })}
          placeholder={members.length ? 'Välj från din enhet' : 'Bara du själv'}
          triggerDisplay="badges"
          hasSearch={members.length > 6}
          presentation="adaptive"
          isDisabled={!members.length}
          disabledMessage="Din enhet har inga medlemmar att bjuda in."
        />
        <Selector
          label="Rum"
          isOptional
          options={[
            { value: '', label: 'Inget rum' },
            ...rooms.map(r => ({
              value: r.ref,
              label: r.name,
              description: `${r.capacity} platser${r.equipment.length ? ' · ' + r.equipment.join(', ') : ''}`,
            })),
          ]}
          value={draft.room}
          onChange={v => booking.patch({ room: v ?? '' })}
          presentation="adaptive"
        />
      </FormLayout>
      {(availability || booking.unread) && (
        <VStack gap={2}>
          <Heading level={3}>Tillgänglighet</Heading>
          {availability ? (
            <List density="compact" hasDividers aria-label="Tillgänglighet">
              <ListItem
                label={<Text>Du</Text>}
                endContent={<State state={availability.mine} word={stateWord[availability.mine]} />}
              />
              {availability.participants.map(p => (
                <ListItem
                  key={p.email}
                  label={<Text>{p.name}</Text>}
                  endContent={<State state={p.state} word={stateWord[p.state]} />}
                />
              ))}
              {availability.room && (
                <ListItem
                  label={<Text>{availability.room.name}</Text>}
                  endContent={<State state={availability.room.state} word={roomWord[availability.room.state]} />}
                />
              )}
            </List>
          ) : (
            <Text type="supporting">Tillgängligheten kunde inte läsas.</Text>
          )}
        </VStack>
      )}
      {error?.uncertain && (
        <Banner status="warning" title="Bokningsresultatet är osäkert" description={error.text} collapsible={false} />
      )}
    </VStack>
  );
}

/** What stands beside the buttons: why "Boka" is greyed, since a greyed button with no word about why is a dead end. */
export function BookingHint({ booking }: { booking: Booking }) {
  return booking.draft && !booking.draft.title.trim() ? (
    <Text type="supporting">Skriv en rubrik så går det att boka.</Text>
  ) : null;
}
/** The form's two buttons: let go of the draft, or book it. */
export function BookingButtons({ booking }: { booking: Booking }) {
  return (
    <>
      <Button size="sm" variant="ghost" label="Avbryt" onClick={booking.close} />
      <Button size="sm" variant="primary" label="Boka" isDisabled={!booking.ready} clickAction={booking.book} />
    </>
  );
}
