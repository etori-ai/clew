import { useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CommitmentOwner, StaffPerson, TalksResult } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  DateInput,
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
  VStack,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../../api';
import { commitmentsQuery, staffQuery, talksQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { useTalkAction } from '../../mutations';
import {
  dueText,
  groupCommitments,
  isOverdue,
  personKey,
  talkAtText,
  talkFor,
  talkStatus,
  type CommitmentEntry,
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
 * state with Markera som hållet and Ångra, the person's action points carried over first, then this round's, then the
 * done ones, and a form to add one while a round is open; the round's name under the tab's heading. Opened only for
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
 * that replaces the one pressed (Klar becomes Öppna igen in the done group, Markera som hållet becomes Ångra) is in the
 * page when the focus is handed to it.
 */
function Talk({ person, talks }: { person: StaffPerson; talks: TalksResult }) {
  const ids = useId();
  const row = talkFor(person.id, talks);
  const round = talks.round;
  const canWrite = talks.writable && !!round && !!row;
  const pointsQ = useQuery(commitmentsQuery(personKey(person)));
  const held = useTalkAction();
  const points = useTalkAction();
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
  const when = row ? talkAtText(row) : null;
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
        {row?.state === 'missing' && talks.bookedUnknown && (
          <Text type="supporting">Kalendern svarade inte, så ett bokat samtal kan visas som saknat.</Text>
        )}
        {!round ? (
          <Text as="p">
            Ingen samtalsomgång är öppen. Samtalet kan inte markeras som hållet och inga åtgärdspunkter kan läggas till.
          </Text>
        ) : (
          !row && <Text as="p">{person.name} är inte med i samtalsomgången.</Text>
        )}
        {canWrite && (
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
                  write('undo-held', () => api.talks.markHeld(person.id), 'Samtalet är markerat som hållet.', held)
                }
              />
            )}
          </HStack>
        )}
        {held.error && (
          <Text as="p" role="alert" color="accent">
            {held.error}
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
