import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { CommitmentOwner, StaffPerson, TalksResult } from '@clew/contracts';
import {
  Badge,
  Banner,
  BottomSheet,
  Button,
  DateInput,
  Drawer,
  DrawerHeader,
  EmptyState,
  FormLayout,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  List,
  ListItem,
  RadioList,
  RadioListItem,
  StackItem,
  Text,
  TextInput,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { commitmentsQuery, staffQuery, talksQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { useTalkAction } from '../mutations';
import { useOverlayTitle } from '../page-title';
import { talkOf, withTalk, withoutTalk } from '../talk-address';
import {
  dueText,
  groupCommitments,
  isOverdue,
  personKey,
  talkAtText,
  talkFor,
  talkStatus,
  type CommitmentEntry,
} from '../talks';
import { AsyncContent, ContentSkeleton } from './loading';
import { mobileQuery, shortQuery } from './shell';

/** The drawer's desktop width budget: one person's talk, a list of short lines and a three-field form. */
const TALK_WIDTH = 560;
/** An action point is one short line (D96 item 4); the contract caps it. */
const TEXT_MAX = 280;

/** Who answers for an action point, as the manager reading the talk is told. */
const responsible = (row: Pick<CommitmentEntry, 'owner' | 'mine'>) =>
  row.mine ? 'Du' : row.owner === 'employee' ? 'Medarbetaren' : 'Chefen';

/**
 * One person's utvecklingssamtal (D96 item 7) as a focused overlay over the page it was opened on (D83, D111 rule 5):
 * an end `Drawer` on a desktop and a tall `BottomSheet` on a phone, composed as the service catalogue's overlay is
 * (`DrawerHeader` in a `Layout`, the sheet's own heading row with Stäng). Mounted by the pages where its way in is
 * drawn, after their panel so it stacks over a card opened beside them: Personal (a row's menu), a person's page (the
 * talks section) and a unit's page. The address is the page's own with `talk=<personId>` (`talk-address.ts`); the page
 * stays mounted under it. Closing (✕, Esc, the way back) replaces the address with the same one without `talk`, and
 * Astryx gives the focus back to the control that opened the drawer; when nothing opened it (a reload, Back after the
 * list was redrawn) `opener` names the person's own control on the page, else the page's way into this talk.
 *
 * Opened only for Clew's own module (`writable`): when another system answers, the page opens that system instead and
 * the address draws nothing. The talk's state with Markera som hållet and Ångra, the person's action points carried
 * over first, then this round's, then the done ones, and a form to add one while a round is open. Nothing is read
 * until an address names a talk, so a page that can open one asks nothing of the talks system until it does.
 */
export function TalkOverlay({
  opener,
  back,
}: {
  opener?: (personId: string) => HTMLElement | null;
  /** The words of the way back from a person who is not there, which names the page under the drawer. */
  back: string;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const talkId = talkOf(search);
  // The person shown, kept while the overlay slides away so its content does not blank mid-exit (Astryx Drawer).
  const [shownId, setShownId] = useState<string | null>(talkId);
  if (talkId && talkId !== shownId) setShownId(talkId);
  const wanted = !!(talkId ?? shownId);
  const staffQ = useQuery({ ...staffQuery, enabled: wanted });
  const talksQ = useQuery({ ...talksQuery, enabled: wanted });
  const talks = talksQ.data;
  const readOnly = talks?.writable === false;
  const settled = staffQ.data !== undefined && (talksQ.data !== undefined || talksQ.isError);
  const isOpen = !!talkId && settled && !readOnly;
  const person = staffQ.data?.units.flatMap(u => u.people).find(p => p.id === shownId) ?? null;
  const found = !!person && !!talks;
  const title = talksQ.isError ? 'Samtal' : found ? person.name : 'Samtalet finns inte';
  const label = found ? `Samtal med ${person.name}` : title;
  // The open talk names the tab (2.4.2), and the page's own name comes back when it closes; with no drawer to show the
  // tab is the page's. Focus moving into the drawer says the name.
  useOverlayTitle(isOpen && found ? label : null);

  const onOpenChange = (open: boolean) => {
    if (!open) navigate(withoutTalk(pathname, search), { replace: true });
  };
  // Astryx returns the focus to the element that opened the overlay. After a reload nothing did, so the focus would
  // stay on the page's body: the person's own control on the page takes it (`opener`), else the page's own way into this
  // talk (a section's "Öppna samtalet"), and nothing else is guessed.
  const page = useRef({ pathname, search: search.toString() });
  page.current = { pathname, search: search.toString() };
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  const openRef = useRef(talkId);
  openRef.current = talkId;
  const shownRef = useRef(shownId);
  shownRef.current = shownId;
  const openerRef = useRef(opener);
  openerRef.current = opener;
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      const id = shownRef.current;
      if (!openRef.current) setShownId(null);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!id || (active && active !== document.body)) return;
        const { pathname, search } = page.current;
        const way = `a[href="${CSS.escape(withTalk(pathname, search, id))}"]`;
        (openerRef.current?.(id) ?? document.querySelector<HTMLElement>(way))?.focus();
      });
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);

  const header = (subtitle?: string) =>
    mobile ? (
      <LayoutHeader>
        <VStack gap={1}>
          <HStack justify="between" vAlign="center" gap={2}>
            <StackItem size="fill">
              <Heading level={2}>{title}</Heading>
            </StackItem>
            <IconButton
              variant="ghost"
              label="Stäng"
              icon={<Icon icon="close" />}
              onClick={() => onOpenChange(false)}
            />
          </HStack>
          {subtitle && <Text type="supporting">{subtitle}</Text>}
        </VStack>
      </LayoutHeader>
    ) : (
      <DrawerHeader title={title} {...(subtitle ? { subtitle } : {})} onOpenChange={onOpenChange} />
    );
  const content = !shownId ? null : talksQ.isError ? (
    <Banner
      status="error"
      title={errorMessage(talksQ.error, 'Samtalet kunde inte hämtas.')}
      endContent={
        <Button
          label="Försök igen"
          size="sm"
          variant="secondary"
          isLoading={talksQ.isFetching}
          onClick={() => void talksQ.refetch()}
        />
      }
    />
  ) : found ? (
    <Talk key={person.id} person={person} talks={talks} />
  ) : (
    <EmptyState
      headingLevel={3}
      title={person ? 'Det finns inga utvecklingssamtal här' : 'Personen finns inte på dina enheter'}
      description={
        person
          ? 'Inget system för utvecklingssamtal svarar för dig.'
          : 'Adressen pekar på någon som inte finns bland medarbetarna du är chef för.'
      }
      actions={<Button label={back} onClick={() => onOpenChange(false)} />}
    />
  );
  const body = shownId ? (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={header(found && talks.round ? talks.round.label : undefined)}
      content={<LayoutContent>{content}</LayoutContent>}
    />
  ) : null;
  return mobile ? (
    <BottomSheet
      ref={sheetPanel}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={label}
      height="tall"
      purpose="form"
    >
      {body}
    </BottomSheet>
  ) : (
    <Drawer
      ref={setDialog}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={label}
      side="end"
      width={TALK_WIDTH}
      purpose="form"
    >
      {body}
    </Drawer>
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
  const writableRow = (c: CommitmentEntry) => !!pointsQ.data?.writable && !!c.id && c.mine;
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
                    {responsible(c)} · senast {dueText(c)}
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
