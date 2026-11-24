import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CommitmentOwner, StaffPerson, TalksResult } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  DateInput,
  DateTimeInput,
  EmptyState,
  FormLayout,
  Heading,
  HStack,
  List,
  ListItem,
  RadioList,
  RadioListItem,
  Text,
  TextInput,
  TimeInput,
  VStack,
} from '@clew/ui';
import { localClock, today } from '@clew/calendar/dates';
import { api } from '../../api';
import { useBranding } from '../../branding';
import { commitmentsQuery, staffQuery, talksQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { useTalkAction } from '../../mutations';
import {
  bookedDay,
  bookingNote,
  calendarDifference,
  dueText,
  endFor,
  groupCommitments,
  isOverdue,
  personKey,
  talkFor,
  talkSpan,
  talkSpanText,
  talkStatus,
  timePassed,
  type CommitmentEntry,
  type TalkEntry,
} from '../../talks';
import { AsyncContent, ContentSkeleton } from '../shell/loading';
import { DOT } from '../../dot';

/** An action point is one short line (D96 item 4); the contract caps it. */
const TEXT_MAX = 280;

/**
 * Who answers for an action point, as the manager reading the talk is told. Another manager's point the reader may tick
 * off (it carries its `id`, Q12) is a former manager's: its owner no longer manages the person.
 */
const responsible = (row: Pick<CommitmentEntry, 'owner' | 'mine' | 'id'>) =>
  row.mine ? 'Du' : row.owner === 'employee' ? 'Medarbetaren' : row.id ? 'Tidigare chef' : 'Chefen';

/**
 * One person's utvecklingssamtal (D96 item 7) as the talk's tab on the person's page (D126 rule 3: the drawer that lay
 * over the page is gone; the talk is where the person is). The address is the person's page with the talk's source as
 * `section` (`person-address.ts`); an address that laid the drawer over a page (`?talk=<personId>`) leads here. Its
 * state with Markera som hållet and Ångra, when it is booked and, for a time no invitation carries, Ange tid, Ändra tid
 * and Ta bort tiden (D132 item 4), what the calendar holds when the meeting was moved or is gone and the manager's
 * choice between them (D133), that the booked time has passed and whether the talk took place (D134), the person's
 * action points carried over first, then this round's, then the done ones, and
 * a form to add one while a round is open; the round's name under the tab's heading. Opened only for
 * Clew's own module (`writable`): when another system answers, the tab is that system's row, as any other source's.
 * Nothing is read until the tab is shown.
 */
export function TalkTab({
  personId,
  name,
  fallback,
}: {
  personId: string;
  name: string;
  /** The source's own row, drawn when the talk cannot be written here: another system answers, or the person is not on the reader's units. */
  fallback?: ReactNode;
}) {
  const staffQ = useQuery(staffQuery);
  const talksQ = useQuery(talksQuery);
  const talks = talksQ.data;
  const person = staffQ.data?.units.flatMap(u => u.people).find(p => p.id === personId) ?? null;
  if (talksQ.isError || staffQ.isError)
    return (
      <Banner
        status="error"
        title={errorMessage(talksQ.error ?? staffQ.error, 'Samtalet kunde inte hämtas.')}
        endContent={
          <Button
            label="Försök igen"
            size="sm"
            variant="secondary"
            isLoading={talksQ.isFetching || staffQ.isFetching}
            onClick={() => void (talksQ.isError ? talksQ.refetch() : staffQ.refetch())}
          />
        }
      />
    );
  if (!talks || !staffQ.data) return <ContentSkeleton label="Hämtar samtalet …" rows={3} heading={false} />;
  if ((!person || !talks.writable) && fallback) return <>{fallback}</>;
  if (!person || !talks.writable)
    return (
      <EmptyState
        isCompact
        headingLevel={3}
        title={person ? 'Det finns inga utvecklingssamtal här' : `${name} finns inte på dina enheter`}
        description={
          person
            ? 'Inget system för utvecklingssamtal svarar för dig.'
            : 'Samtalet skrivs av den som är chef för personen.'
        }
      />
    );
  return (
    <VStack gap={4}>
      {talks.round && <Text type="supporting">{talks.round.label}</Text>}
      <Talk key={person.id} person={person} talks={talks} />
    </VStack>
  );
}

/**
 * The talk itself. Writes go through `useTalkAction`, which waits for the fresh reads before it lets go, so the control
 * that replaces the one pressed (Klar becomes Öppna igen in the done group, Markera som hållet becomes Ångra, Ange tid
 * becomes Ändra tid) is in the page when the focus is handed to it. The time's form takes the place of the time's
 * buttons while it is open, and the button comes back with the focus when it closes.
 */
function Talk({ person, talks }: { person: StaffPerson; talks: TalksResult }) {
  const ids = useId();
  const row = talkFor(person.id, talks);
  const site = useBranding().name;
  const round = talks.round;
  const canWrite = talks.writable && !!round && !!row;
  const pointsQ = useQuery(commitmentsQuery(personKey(person)));
  const held = useTalkAction();
  const time = useTalkAction();
  const points = useTalkAction();
  const [settingTime, setSettingTime] = useState(false);
  // The control that should hold the focus once it is drawn: the one that took the pressed control's place.
  const want = useRef<string | null>(null);
  const claim = (key: string) => (el: HTMLElement | null) => {
    if (el && want.current === key) {
      want.current = null;
      el.focus();
    }
  };
  const write = async (key: string, fn: () => Promise<unknown>, done: string, action: typeof held) => {
    want.current = key;
    if (!(await action.run(fn, done))) want.current = null;
  };
  const when = row ? talkSpanText(row) : null;
  const note = row ? bookingNote(row, site) : null;
  // The meeting in the calendar is not where the talk says: the talk stands, and the manager whose booking it is chooses.
  const differs = row ? calendarDifference(row) : null;
  const settles = canWrite && !!differs && row.own === true;
  // The booked time has passed and the talk is not marked held: the manager says whether it took place (D134). A time
  // set by hand is taken off with Ta bort tiden, as at any time; an invitation is ended here, by its own manager.
  const passed = canWrite && !differs && timePassed(row, Date.now());
  const missable = passed && row.invited === true && row.own === true;
  // A time is set and changed here while no invitation carries the booking, and never for a talk that is held.
  const timeByHand = canWrite && row.state !== 'held' && !(row.state === 'booked' && row.invited !== false);
  const day = today();
  const list = pointsQ.data?.rows ?? [];
  const groups = groupCommitments(list);
  // A row carries its `id` only when the reader may change it: their own, or a former manager's they take over (Q12).
  const writableRow = (c: CommitmentEntry) => !!pointsQ.data?.writable && !!c.id;
  const group = (heading: string, rows: CommitmentEntry[]) =>
    rows.length === 0 ? null : (
      <VStack gap={1} as="section" aria-labelledby={`${ids}-${heading}`}>
        <Heading level={4} id={`${ids}-${heading}`}>
          {heading}
        </Heading>
        <List aria-label={heading} hasDividers density="compact">
          {rows.map(c => (
            <ListItem
              key={c.ref}
              align="start"
              label={<Text>{c.text}</Text>}
              description={
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="supporting">
                    {responsible(c)}
                    {DOT}senast {dueText(c)}
                  </Text>
                  {isOverdue(c, day) && <Badge variant="error" label="Försenad" />}
                </HStack>
              }
              endContent={
                writableRow(c) ? (
                  c.done ? (
                    <Button
                      ref={claim(`reopen:${c.id}`)}
                      size="sm"
                      variant="secondary"
                      label="Öppna igen"
                      aria-label={`Öppna igen: ${c.text}`}
                      clickAction={() =>
                        write(`done:${c.id}`, () => api.talks.reopen(c.id!), 'Åtgärdspunkten är öppen igen.', points)
                      }
                    />
                  ) : (
                    <Button
                      ref={claim(`done:${c.id}`)}
                      size="sm"
                      variant="secondary"
                      label="Klar"
                      aria-label={`Klar: ${c.text}`}
                      clickAction={() =>
                        write(`reopen:${c.id}`, () => api.talks.complete(c.id!), 'Åtgärdspunkten är klar.', points)
                      }
                    />
                  )
                ) : undefined
              }
            />
          ))}
        </List>
      </VStack>
    );
  return (
    <VStack gap={6}>
      <VStack gap={3} as="section" aria-labelledby={`${ids}-state`}>
        <Heading level={3} id={`${ids}-state`}>
          Samtalet
        </Heading>
        {row && (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Badge {...talkStatus(row.state)} />
            {when && <Text>{when}</Text>}
          </HStack>
        )}
        {note && <Text type="supporting">{note}</Text>}
        {differs && (
          <Banner
            status="warning"
            title={differs.kind === 'gone' ? 'Mötet är borta ur kalendern' : 'Mötet har flyttats i kalendern'}
            description={
              settles
                ? differs.kind === 'gone'
                  ? `${differs.text} Välj om tiden ska stå kvar utan inbjudan.`
                  : `${differs.text} Stämmer inte den nya tiden flyttar du tillbaka mötet i kalendern.`
                : `${differs.text} Chefen som bokade samtalet avgör vad som gäller.`
            }
            endContent={
              settles ? (
                <HStack gap={2} wrap="wrap">
                  {differs.kind === 'moved' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Flytta samtalet till den nya tiden"
                      clickAction={() =>
                        write(
                          'mark-held',
                          () => api.talks.settleCalendar(person.id, 'adopt'),
                          'Samtalet har flyttats till den nya tiden.',
                          time,
                        )
                      }
                    />
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        label="Behåll tiden"
                        clickAction={() =>
                          write(
                            'set-time',
                            () => api.talks.settleCalendar(person.id, 'keep'),
                            'Tiden står kvar, utan inbjudan.',
                            time,
                          )
                        }
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        label="Ta bort tiden"
                        clickAction={() =>
                          write(
                            'set-time',
                            () => api.talks.settleCalendar(person.id, 'remove'),
                            'Tiden för samtalet är borttagen.',
                            time,
                          )
                        }
                      />
                    </>
                  )}
                </HStack>
              ) : undefined
            }
          />
        )}
        {passed && (
          <Banner
            status="info"
            title="Tiden för samtalet har passerat"
            description="Markera samtalet som hållet om det blev av. Annars tar du bort tiden, så kan samtalet bokas igen."
            endContent={
              missable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  label="Samtalet blev inte av"
                  clickAction={() =>
                    write(
                      'set-time',
                      () => api.talks.settleCalendar(person.id, 'missed'),
                      'Tiden för samtalet är borttagen.',
                      time,
                    )
                  }
                />
              ) : undefined
            }
          />
        )}
        {!round ? (
          <Text as="p">
            Ingen samtalsomgång är öppen. Samtalet kan inte markeras som hållet och inga åtgärdspunkter kan läggas till.
          </Text>
        ) : (
          !row && <Text as="p">{person.name} är inte med i samtalsomgången.</Text>
        )}
        {canWrite && !settingTime && (
          <HStack gap={2} wrap="wrap">
            {row.state === 'held' ? (
              <Button
                ref={claim('undo-held')}
                variant="secondary"
                label="Ångra"
                clickAction={() =>
                  write(
                    'mark-held',
                    () => api.talks.unmarkHeld(person.id),
                    'Samtalet är inte längre markerat som hållet.',
                    held,
                  )
                }
              />
            ) : (
              <Button
                ref={claim('mark-held')}
                variant="primary"
                label="Markera som hållet"
                clickAction={() =>
                  write(
                    'undo-held',
                    // A talk whose booked time has passed was held the day it was booked for, not the day this is pressed.
                    () => api.talks.markHeld(person.id, passed ? { heldOn: bookedDay(row) } : {}),
                    'Samtalet är markerat som hållet.',
                    held,
                  )
                }
              />
            )}
            {timeByHand && (
              <Button
                ref={claim('set-time')}
                variant="secondary"
                label={row.state === 'booked' ? 'Ändra tid' : 'Ange tid'}
                onClick={() => {
                  time.reset();
                  setSettingTime(true);
                }}
              />
            )}
            {timeByHand && row.state === 'booked' && (
              <Button
                variant="ghost"
                label="Ta bort tiden"
                clickAction={() =>
                  write('set-time', () => api.talks.unbook(person.id), 'Tiden för samtalet är borttagen.', time)
                }
              />
            )}
          </HStack>
        )}
        {timeByHand && settingTime && (
          <TalkTime
            person={person}
            row={row}
            onClose={() => {
              // The button the form took the place of comes back, and takes the focus.
              want.current = 'set-time';
              setSettingTime(false);
            }}
          />
        )}
        {(held.error ?? time.error) && (
          <Text as="p" role="alert" color="accent">
            {held.error ?? time.error}
          </Text>
        )}
      </VStack>
      <VStack gap={3} as="section" aria-labelledby={`${ids}-points`}>
        <Heading level={3} id={`${ids}-points`}>
          Åtgärdspunkter
        </Heading>
        <AsyncContent
          pending={pointsQ.isPending}
          fallback={<ContentSkeleton label="Hämtar åtgärdspunkterna …" rows={3} heading={false} />}
          gap={4}
        >
          {pointsQ.isError ? (
            <VStack gap={2}>
              <Text as="p" role="alert">
                {errorMessage(pointsQ.error, 'Åtgärdspunkterna kunde inte hämtas.')}
              </Text>
              <HStack>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Försök igen"
                  isLoading={pointsQ.isFetching}
                  onClick={() => void pointsQ.refetch()}
                />
              </HStack>
            </VStack>
          ) : list.length === 0 ? (
            <Text type="supporting">Inga åtgärdspunkter än.</Text>
          ) : (
            <>
              {group('Kvar från tidigare samtal', groups.carried)}
              {group('Från det här samtalet', groups.open)}
              {group('Klara', groups.done)}
            </>
          )}
          {points.error && (
            <Text as="p" role="alert" color="accent">
              {points.error}
            </Text>
          )}
        </AsyncContent>
      </VStack>
      {canWrite && <AddCommitment person={person} />}
    </VStack>
  );
}

/**
 * When the talk takes place (D132 item 4), for a time the manager and the employee agreed on and no invitation from
 * Clew carries: the day and the start in one field and the end the same day, as a booking is picked in the calendar
 * (Astryx's date-time and time fields, Monday first, a sheet under a finger). An hour is suggested for the end when the
 * start is picked, and the end keeps the talk's length when the start is changed. What is missing is said on the field when Spara is pressed, and the focus goes to that field; the
 * server's sentence is an alert under the fields and what was picked stays. The focus is in the first field when the
 * form opens, and goes back to the button that opened it when it closes.
 */
function TalkTime({ person, row, onClose }: { person: StaffPerson; row: TalkEntry; onClose: () => void }) {
  const ids = useId();
  const save = useTalkAction();
  const booked = row.state === 'booked' && row.at && row.until ? { start: row.at, end: row.until } : null;
  const [start, setStart] = useState(booked ? localClock(booked.start) : '');
  const [end, setEnd] = useState(booked ? localClock(booked.end).slice(11, 16) : '');
  const [tried, setTried] = useState(false);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    startField.current?.focus();
  }, []);
  const span = talkSpan(start, end);
  const problem = 'problem' in span ? span : null;
  const submit = async () => {
    if (save.busy) return;
    if ('problem' in span) {
      setTried(true);
      (span.problem === 'start' ? startField : endField).current?.focus();
      return;
    }
    if (await save.run(() => api.talks.book(person.id, span), 'Tiden för samtalet är sparad.')) onClose();
  };
  const status = (field: 'start' | 'end') =>
    tried && problem?.problem === field ? { status: { type: 'error' as const, message: problem.message } } : {};
  return (
    <VStack
      gap={3}
      as="form"
      aria-labelledby={`${ids}-time`}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <VStack gap={1}>
        <Heading level={4} id={`${ids}-time`}>
          Tid för samtalet
        </Heading>
        <Text type="supporting">
          Ange den tid ni har kommit överens om. Tiden sparas i Clew och ingen inbjudan skickas.
        </Text>
      </VStack>
      <FormLayout defaultOptionality="required">
        <DateTimeInput
          ref={startField}
          label="Börjar"
          value={start as never}
          onChange={value => {
            setStart(value ?? '');
            // The end follows the start: an hour after it, or the length the talk had.
            if (value) setEnd(endFor(start, end, value));
          }}
          weekStartsOn="mon"
          timeIncrement={15}
          placeholder="Välj en dag"
          timePlaceholder="Välj en tid"
          presentation="adaptive-bottom-sheet"
          {...status('start')}
        />
        <TimeInput
          ref={endField}
          label="Slutar"
          value={end as never}
          onChange={value => setEnd(value ?? '')}
          increment={15}
          placeholder="Välj en tid"
          {...status('end')}
        />
      </FormLayout>
      {save.error && (
        <Text as="p" role="alert" color="accent">
          {save.error}
        </Text>
      )}
      <HStack gap={2}>
        <Button type="submit" variant="primary" label="Spara" isLoading={save.busy} />
        <Button variant="ghost" label="Avbryt" onClick={onClose} />
      </HStack>
    </VStack>
  );
}

/**
 * Adding an action point (D96 item 4): what is to be done, one line; who answers for it, the employee or the manager
 * reading; the day it is due, picked as dates are picked elsewhere (Astryx's date field, Monday first, a sheet under a
 * finger). What is missing is said on the field when Lägg till is pressed, and the focus goes to the first such field.
 * The server's sentence is an alert under the fields and what was typed stays; on success the fields empty and the
 * focus goes back to the text, ready for the next one.
 */
function AddCommitment({ person }: { person: StaffPerson }) {
  const ids = useId();
  const add = useTalkAction();
  const [text, setText] = useState('');
  const [owner, setOwner] = useState<CommitmentOwner>('employee');
  const [dueOn, setDueOn] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const textField = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const trimmed = text.trim();
  const textProblem = !trimmed
    ? 'Skriv vad som ska göras.'
    : trimmed.length > TEXT_MAX
      ? `Högst ${TEXT_MAX} tecken.`
      : null;
  const dateProblem = dueOn ? null : 'Välj ett datum.';
  const submit = async () => {
    if (add.busy) return;
    if (textProblem || dateProblem) {
      setTried(true);
      (textProblem ? textField : dateField).current?.focus();
      return;
    }
    const ok = await add.run(
      () => api.talks.addCommitment(person.id, { owner, text: trimmed, dueOn: dueOn! }),
      'Åtgärdspunkten är tillagd.',
    );
    if (!ok) return;
    setText('');
    setDueOn(undefined);
    setTried(false);
    textField.current?.focus();
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  return (
    <VStack
      gap={3}
      as="form"
      aria-labelledby={`${ids}-add`}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <Heading level={3} id={`${ids}-add`}>
        Ny åtgärdspunkt
      </Heading>
      <FormLayout defaultOptionality="required">
        <TextInput
          ref={textField}
          label="Vad ska göras"
          description={`En rad, högst ${TEXT_MAX} tecken.`}
          value={text}
          onChange={setText}
          autoComplete="off"
          {...status(textProblem)}
        />
        <RadioList
          label="Vem ansvarar"
          value={owner}
          onChange={value => setOwner(value as CommitmentOwner)}
          orientation="horizontal"
        >
          <RadioListItem value="employee" label="Medarbetaren" />
          <RadioListItem value="manager" label="Du" />
        </RadioList>
        <DateInput
          ref={dateField}
          label="Klart senast"
          value={dueOn as never}
          onChange={value => setDueOn(value ?? undefined)}
          min={today() as never}
          weekStartsOn="mon"
          placeholder="Välj ett datum"
          presentation="adaptive-bottom-sheet"
          {...status(dateProblem)}
        />
      </FormLayout>
      {add.error && (
        <Text as="p" role="alert" color="accent">
          {add.error}
        </Text>
      )}
      <HStack>
        <Button type="submit" variant="primary" label="Lägg till" isLoading={add.busy} />
      </HStack>
    </VStack>
  );
}
