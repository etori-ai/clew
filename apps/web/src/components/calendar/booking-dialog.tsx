import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityResult, CalendarMember, CalendarRoom } from '@clew/contracts';
import { Banner, Button, DateTimeInput, Dialog, DialogHeader, FormLayout, HStack, List, ListItem, MultiSelector, Selector, StatusDot, Text, TextInput, TimeInput, VStack, useAnnounce, useMediaQuery, useToast } from '@clew/ui';
import { localClock, localInstant, shortDayLabel, timeRange } from '@clew/calendar/dates';
import { api } from '../../api';
import { membersQuery, roomsQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { keys } from '../../query-keys';
import { mobileQuery } from '../shell';

const EMPTY_MEMBERS: CalendarMember[] = [];
const EMPTY_ROOMS: CalendarRoom[] = [];

type Props = {
  isOpen: boolean;
  /** The time to start from: a span selected on the grid, or the next whole hour. ISO instants. */
  initial: { start: string; end: string };
  onClose: (created: boolean) => void;
};
const stateWord = { free: 'ledig', busy: 'upptagen', unknown: 'okänt' } as const;
const stateDot = { free: 'success', busy: 'warning', unknown: 'neutral' } as const;
const hhmm = (instant: string) => localClock(instant).slice(11, 16);

/**
 * "Ny bokning" (D32, after startsidan's meeting form): a title, a start, an end, guests from the unit and a room, with a
 * free-busy check before the person books. The form is the keyboard path to a booking; a span dragged on the grid only
 * fills it in. Modelled on Astryx's form-wizard-dialog: a form dialog that keeps its content when clicked outside.
 */
export function BookingDialog({ isOpen, initial, onClose }: Props) {
  const mobile = useMediaQuery(mobileQuery);
  const announce = useAnnounce();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [room, setRoom] = useState('');
  // The unit's members and the rooms come from the cache and are kept a while (D33), so the dialog opens with them.
  const client = useQueryClient();
  const members = useQuery({ ...membersQuery, enabled: isOpen }).data?.members ?? EMPTY_MEMBERS;
  const rooms = useQuery({ ...roomsQuery, enabled: isOpen }).data?.rooms ?? EMPTY_ROOMS;
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; uncertain: boolean } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setTitle(''); setStart(localClock(initial.start)); setEnd(hhmm(initial.end)); setParticipants([]); setRoom(''); setAvailability(null); setError(null);
  }, [isOpen, initial.start, initial.end]);
  useEffect(() => { setAvailability(null); }, [start, end, participants, room]);
  const startAt = start ? localInstant(start) : null;
  const endAt = startAt && end ? localInstant(`${start.slice(0, 10)}T${end}`) : null;
  const endFirst = !!startAt && !!endAt && Date.parse(endAt) <= Date.parse(startAt);
  const ready = !!title.trim() && !!startAt && !!endAt && !endFirst;
  const input = () => ({ start: startAt!, end: endAt!, participants, ...(room ? { room } : {}) });
  const check = async () => {
    if (!startAt || !endAt || endFirst) return;
    setError(null);
    try { const result = await api.availability(input()); setAvailability(result); announce(`Du är ${stateWord[result.mine]}. ${result.participants.map(p => `${p.name} ${stateWord[p.state]}`).join(', ')}${result.room ? `. Rummet ${result.room.name} ${stateWord[result.room.state]}` : ''}.`); }
    catch (e) { setError({ text: errorMessage(e, 'Något gick fel.'), uncertain: false }); }
  };
  const book = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const event = await api.createEvent({ title: title.trim(), ...input() });
      // The booking is in the calendar: every loaded week is read again (D33).
      void client.invalidateQueries({ queryKey: keys.calendarAll });
      toast({ body: `Bokat: ${event.title} ${shortDayLabel(event.start.slice(0, 10))} ${timeRange(event.start, event.end)}`, uniqueID: 'booked:' + event.id });
      onClose(true);
    } catch (e) {
      const text = errorMessage(e, 'Något gick fel.');
      setError({ text, uncertain: /osäker/.test(text) });
    } finally { setBusy(false); }
  };
  const close = () => onClose(false);
  return <Dialog isOpen={isOpen} onOpenChange={open => { if (!open) close(); }} width={560} purpose="form" variant={mobile ? 'fullscreen' : 'standard'}>
    <DialogHeader title="Ny bokning" subtitle="I din kalender, med inbjudan till dem du väljer." onOpenChange={open => { if (!open) close(); }} />
    <VStack gap={3} padding={3}>
      <FormLayout direction="vertical" defaultOptionality="required">
        <TextInput label="Rubrik" value={title} onChange={setTitle} isRequired placeholder="Vad handlar mötet om?" />
        <DateTimeInput label="Börjar" value={start as never} onChange={v => setStart(v ?? '')} isRequired weekStartsOn="mon" timeIncrement={15} presentation="adaptive-bottom-sheet" />
        <TimeInput label="Slutar" value={end as never} onChange={v => setEnd(v ?? '')} isRequired increment={15} status={endFirst ? { type: 'error', message: 'Sluttiden måste vara efter starttiden.' } : undefined} />
        <MultiSelector label="Deltagare" isOptional options={members.map(m => ({ value: m.email, label: m.name }))} value={participants} onChange={v => setParticipants(v.slice(0, 8))}
          placeholder={members.length ? 'Välj från din enhet' : 'Bara du själv'} triggerDisplay="badges" hasSearch={members.length > 6} presentation="adaptive" isDisabled={!members.length} disabledMessage="Din enhet har inga medlemmar att bjuda in." />
        <Selector label="Rum" isOptional options={[{ value: '', label: 'Inget rum' }, ...rooms.map(r => ({ value: r.ref, label: r.name, description: `${r.capacity} platser${r.equipment.length ? ' · ' + r.equipment.join(', ') : ''}` }))]} value={room} onChange={v => setRoom(v ?? '')} presentation="adaptive" />
      </FormLayout>
      {availability && <List density="compact" hasDividers aria-label="Tillgänglighet">
        <ListItem label={<Text>Du</Text>} endContent={<StatusDot variant={stateDot[availability.mine]} label={stateWord[availability.mine]} />} />
        {availability.participants.map(p => <ListItem key={p.email} label={<Text>{p.name}</Text>} endContent={<StatusDot variant={stateDot[p.state]} label={stateWord[p.state]} />} />)}
        {availability.room && <ListItem label={<Text>{availability.room.name}</Text>} endContent={<StatusDot variant={stateDot[availability.room.state]} label={stateWord[availability.room.state]} />} />}
      </List>}
      {error && (error.uncertain
        ? <Banner status="warning" title="Bokningsresultatet är osäkert" description={error.text} collapsible={false} />
        : <Text as="p" role="alert" color="accent">{error.text}</Text>)}
      <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
        <Button size="sm" variant="ghost" label="Kontrollera tillgänglighet" isDisabled={!startAt || !endAt || endFirst} clickAction={check} />
        <HStack gap={2}>
          <Button size="sm" variant="ghost" label="Avbryt" onClick={close} />
          <Button size="sm" variant="primary" label="Boka" isDisabled={!ready} clickAction={book} />
        </HStack>
      </HStack>
    </VStack>
  </Dialog>;
}
