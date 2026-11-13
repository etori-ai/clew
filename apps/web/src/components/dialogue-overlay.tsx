import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  DIALOGUE_TEXT_MAX,
  type DialogueActivity,
  type DialogueArea,
  type DialogueAssessment,
  type DialogueDimension,
  type DialogueTone,
  type DialogueUnit,
} from '@clew/contracts';
import {
  AlertDialog,
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
  Tab,
  TabList,
  Text,
  TextArea,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { dialogueQuery, entityDetailQuery, entitySectionQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { useDialogueAction } from '../mutations';
import { useOverlayTitle } from '../page-title';
import { dialogueOf, withDialogue, withoutDialogue } from '../dialogue-address';
import { ContentSkeleton } from './loading';
import { Summary } from './unit-figures';
import { mobileQuery, shortQuery } from './shell';

/** The drawer's desktop width: a unit's dialogue, area by area, with its forms. */
const DIALOGUE_WIDTH = 600;
/** The words of a state, as the server's `TONE_WORDS`; the colour is never alone. */
const TONE: Record<DialogueTone, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  ok: { label: 'Bra', variant: 'success' },
  warn: { label: 'Bevaka', variant: 'warning' },
  alert: { label: 'Åtgärd krävs', variant: 'error' },
};
const dayMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', day: 'numeric', month: 'long' });
/** "12 mars" for a `YYYY-MM-DD` day. */
const dayText = (day: string) => dayMonth.format(new Date(day + 'T12:00:00Z'));
const instant = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** "13 nov 2026" for an instant. */
const instantText = (at: string) => instant.format(new Date(at)).replace(/\./g, '');

/**
 * One unit's follow-up dialogue (D118) as a focused overlay over the unit's page (D83, D111 rule 5), composed as the
 * talk drawer is: an end `Drawer` on a desktop and a tall `BottomSheet` on a phone. The address is the page's own with
 * `dialog=<unitId>` (`dialogue-address.ts`); the page stays mounted under it. Closing (✕, Esc, the way back) replaces the
 * address with the same one without `dialog`, and the focus goes back to what opened it, else the section's "Öppna
 * dialogen". Nothing is read until an address names a dialogue.
 *
 * The areas are tabs; each shows its figure or its assessment per dimension with the history, the questions to talk
 * about, and the activities with a form to add one. A refusal (the module switched off, a unit the reader does not follow
 * up) is the dialogue that is not there, with the way back.
 */
export function DialogueOverlay({ unitId, back }: { unitId: string; back: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const named = dialogueOf(search);
  // The dialogue shown, kept while the overlay slides away so its content does not blank mid-exit (Astryx Drawer).
  const [shownId, setShownId] = useState<string | null>(named);
  if (named && named !== shownId) setShownId(named);
  const read = useQuery({ ...dialogueQuery(shownId ?? unitId), enabled: !!shownId });
  const data = read.data;
  const settled = read.data !== undefined || read.isError;
  const isOpen = !!named && settled;
  const found = !!data && shownId === unitId;
  const title = read.isError ? 'Dialog' : found ? data.unit.label : 'Dialogen finns inte';
  const label = found ? `Dialog med ${data.unit.label}` : title;
  useOverlayTitle(isOpen && found ? label : null);

  const onOpenChange = (open: boolean) => {
    if (!open) navigate(withoutDialogue(pathname, search), { replace: true });
  };
  // After a reload nothing opened the drawer, so the focus would stay on the page's body: the section's way into this
  // dialogue takes it.
  const page = useRef({ pathname, search: search.toString() });
  page.current = { pathname, search: search.toString() };
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  const openRef = useRef(named);
  openRef.current = named;
  const shownRef = useRef(shownId);
  shownRef.current = shownId;
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      const id = shownRef.current;
      if (!openRef.current) setShownId(null);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!id || (active && active !== document.body)) return;
        const { pathname, search } = page.current;
        document.querySelector<HTMLElement>(`a[href="${CSS.escape(withDialogue(pathname, search, id))}"]`)?.focus();
      });
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);

  const header = mobile ? (
    <LayoutHeader>
      <HStack justify="between" vAlign="center" gap={2}>
        <StackItem size="fill">
          <Heading level={2}>{title}</Heading>
        </StackItem>
        <IconButton variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={() => onOpenChange(false)} />
      </HStack>
    </LayoutHeader>
  ) : (
    <DrawerHeader title={title} {...(found ? { subtitle: 'Uppföljningsdialog' } : {})} onOpenChange={onOpenChange} />
  );
  const content = !shownId ? null : read.isError ? (
    <Banner
      status="error"
      title={errorMessage(read.error, 'Dialogen kunde inte hämtas.')}
      endContent={
        <Button
          label="Försök igen"
          size="sm"
          variant="secondary"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      }
    />
  ) : found ? (
    data.areas.length ? (
      <Dialogue key={data.unit.id} data={data} />
    ) : (
      <EmptyState
        headingLevel={3}
        title="Dialogen har inga områden än"
        description="Ingen har lagt in områdena och frågorna för uppföljningsdialogen."
        actions={<Button label={back} onClick={() => onOpenChange(false)} />}
      />
    )
  ) : (
    <EmptyState
      headingLevel={3}
      title="Dialogen finns inte"
      description="Enheten finns inte bland dem du följer upp, eller så är dialogstödet avstängt."
      actions={<Button label={back} onClick={() => onOpenChange(false)} />}
    />
  );
  const body = shownId ? (
    <Layout height={short ? 'auto' : 'fill'} header={header} content={<LayoutContent>{content}</LayoutContent>} />
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
      width={DIALOGUE_WIDTH}
      purpose="form"
    >
      {body}
    </Drawer>
  );
}

/** The areas as tabs, the chosen one's panel under them. */
function Dialogue({ data }: { data: DialogueUnit }) {
  const ids = useId();
  const [areaKey, setAreaKey] = useState(data.areas[0]!.key);
  const area = data.areas.find(a => a.key === areaKey) ?? data.areas[0]!;
  const panelId = (key: string) => `${ids}-panel-${key}`;
  return (
    <VStack gap={4}>
      <TabList value={area.key} onChange={setAreaKey} role="tablist" size="sm" hasDivider aria-label="Områden">
        {data.areas.map(a => (
          <Tab key={a.key} value={a.key} label={a.title} panelId={panelId(a.key)} />
        ))}
      </TabList>
      <div id={panelId(area.key)} role="tabpanel" aria-label={area.title}>
        <AreaPanel key={area.key} area={area} data={data} />
      </div>
    </VStack>
  );
}

function AreaPanel({ area, data }: { area: DialogueArea; data: DialogueUnit }) {
  const ids = useId();
  return (
    <VStack gap={6}>
      {area.kind === 'measured' ? (
        <VStack gap={2} as="section" aria-labelledby={`${ids}-figure`}>
          <Heading level={3} id={`${ids}-figure`}>
            Nyckeltalet
          </Heading>
          {area.measure ? <MeasuredFigure unitId={data.unit.id} capability={area.measure} /> : null}
          {area.info && <Text type="supporting">{area.info}</Text>}
        </VStack>
      ) : (
        <VStack gap={4} as="section" aria-labelledby={`${ids}-assessment`}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={3} id={`${ids}-assessment`}>
              Bedömning
            </Heading>
            {area.tone && <Badge variant={TONE[area.tone].variant} label={TONE[area.tone].label} />}
          </HStack>
          {area.info && <Text type="supporting">{area.info}</Text>}
          {area.dimensions.map(d => (
            <Dimension key={d.key} unitId={data.unit.id} area={area} dimension={d} writable={data.writable} />
          ))}
        </VStack>
      )}
      {area.questions.length > 0 && (
        <VStack gap={2} as="section" aria-labelledby={`${ids}-questions`}>
          <Heading level={3} id={`${ids}-questions`}>
            Att prata om
          </Heading>
          <List aria-label="Att prata om" hasDividers density="compact">
            {area.questions.map((q, i) => (
              <ListItem
                key={i}
                align="start"
                label={<Text>{q.text}</Text>}
                {...(q.heading || q.basedOn
                  ? {
                      description: (
                        <VStack gap={1}>
                          {q.heading && <Text type="supporting">{q.heading}</Text>}
                          {q.basedOn && <Text type="supporting">Bygger på: ”{q.basedOn}”</Text>}
                        </VStack>
                      ),
                    }
                  : {})}
              />
            ))}
          </List>
        </VStack>
      )}
      <Activities area={area} data={data} />
    </VStack>
  );
}

/** A measured area's figure for the unit: the key-figure source's row in short, as the unit's page and Dialogstöd show it. */
function MeasuredFigure({ unitId, capability }: { unitId: string; capability: string }) {
  const detail = useQuery(entityDetailQuery('unit', unitId));
  const source = detail.data?.sections.find(s => s.capability === capability);
  const key = detail.data?.entity.key ?? unitId;
  const section = useQuery({ ...entitySectionQuery('unit', key, capability), enabled: !!source });
  if (detail.isPending || (source && section.isPending))
    return <ContentSkeleton label="Hämtar nyckeltalet …" rows={1} heading={false} />;
  const row = section.data?.status === 'ok' ? section.data.row : undefined;
  if (!source || !row) return <Text type="supporting">Nyckeltalet finns inte för enheten just nu.</Text>;
  return (
    <VStack gap={1}>
      <Summary source={source} row={row} />
      <Text type="supporting">Källa: {source.source}</Text>
    </VStack>
  );
}

/** "Ingrid Holm · 13 nov 2026" under a state. */
const byline = (a: DialogueAssessment) => [a.by, instantText(a.at)].filter(Boolean).join(' · ');

/** One dimension of an assessed area: its state now, a form to set it, and the earlier states. */
function Dimension({
  unitId,
  area,
  dimension,
  writable,
}: {
  unitId: string;
  area: DialogueArea;
  dimension: DialogueDimension;
  writable: boolean;
}) {
  const ids = useId();
  const [latest, ...earlier] = dimension.history;
  const heading = dimension.title || area.title;
  return (
    <VStack gap={3} as="section" aria-labelledby={`${ids}-dim`}>
      <Heading level={4} id={`${ids}-dim`}>
        {heading}
      </Heading>
      {latest ? (
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Badge variant={TONE[latest.tone].variant} label={TONE[latest.tone].label} />
            <Text type="supporting">{byline(latest)}</Text>
          </HStack>
          {latest.comment && <Text>{latest.comment}</Text>}
        </VStack>
      ) : (
        <Text type="supporting">Inte bedömd än.</Text>
      )}
      {writable && <AssessForm unitId={unitId} area={area} dimension={dimension} heading={heading} />}
      {earlier.length > 0 && (
        <List aria-label={`Tidigare bedömningar av ${heading}`} hasDividers density="compact">
          {earlier.map((a, i) => (
            <ListItem
              key={i}
              align="start"
              label={<Badge variant={TONE[a.tone].variant} label={TONE[a.tone].label} />}
              description={
                <VStack gap={1}>
                  {a.comment && <Text>{a.comment}</Text>}
                  <Text type="supporting">{byline(a)}</Text>
                </VStack>
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}

/** Setting a dimension's state: the state, an optional comment, Spara. The state is required. */
function AssessForm({
  unitId,
  area,
  dimension,
  heading,
}: {
  unitId: string;
  area: DialogueArea;
  dimension: DialogueDimension;
  heading: string;
}) {
  const action = useDialogueAction();
  const [tone, setTone] = useState<DialogueTone | ''>('');
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const toneProblem = tone ? null : 'Välj ett läge.';
  const commentProblem =
    comment.trim().length > DIALOGUE_TEXT_MAX.comment ? `Högst ${DIALOGUE_TEXT_MAX.comment} tecken.` : null;
  const submit = async () => {
    if (action.busy) return;
    if (toneProblem || commentProblem) {
      setTried(true);
      return;
    }
    const ok = await action.run(
      () =>
        api.dialogue.assess(unitId, {
          area: area.key,
          ...(dimension.key ? { dimension: dimension.key } : {}),
          tone: tone as DialogueTone,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      `Bedömningen av ${heading} är sparad.`,
    );
    if (!ok) return;
    setTone('');
    setComment('');
    setTried(false);
  };
  return (
    <VStack
      gap={3}
      as="form"
      aria-label={`Ny bedömning av ${heading}`}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormLayout defaultOptionality="required">
        <RadioList
          label="Läge"
          value={tone}
          onChange={value => setTone(value as DialogueTone)}
          orientation="horizontal"
          {...(tried && toneProblem ? { status: { type: 'error' as const, message: toneProblem } } : {})}
        >
          <RadioListItem value="ok" label={TONE.ok.label} />
          <RadioListItem value="warn" label={TONE.warn.label} />
          <RadioListItem value="alert" label={TONE.alert.label} />
        </RadioList>
        <TextArea
          label="Kommentar"
          isOptional
          value={comment}
          onChange={setComment}
          rows={2}
          maxLength={DIALOGUE_TEXT_MAX.comment}
          {...(tried && commentProblem ? { status: { type: 'error' as const, message: commentProblem } } : {})}
        />
      </FormLayout>
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      <HStack>
        <Button type="submit" variant="secondary" label="Spara bedömning" isLoading={action.busy} />
      </HStack>
    </VStack>
  );
}

type Editing = { id: string; mode: 'done' | 'edit' } | null;

/** The area's activities: the open ones first, then the done ones; each with what can be done to it; a form to add one. */
function Activities({ area, data }: { area: DialogueArea; data: DialogueUnit }) {
  const ids = useId();
  const action = useDialogueAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<DialogueActivity | null>(null);
  // A removed activity takes the control that opened the confirmation with it, so the focus goes to the section's
  // heading once the confirmation has closed (2.4.3); without this it would fall to the page's body.
  const heading = useRef<HTMLHeadingElement>(null);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    if (!removed || removing) return;
    const frame = requestAnimationFrame(() => {
      heading.current?.focus();
      setRemoved(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [removed, removing]);
  const day = today();
  const open = area.activities.filter(a => !a.doneAt),
    done = area.activities.filter(a => a.doneAt);
  // The control that should hold the focus once it is drawn: the one that took the pressed control's place.
  const want = useRef<string | null>(null);
  const claim = (key: string) => (el: HTMLElement | null) => {
    if (el && want.current === key) {
      want.current = null;
      el.focus();
    }
  };
  const write = async (key: string, fn: () => Promise<unknown>, sentence: string) => {
    want.current = key;
    if (!(await action.run(fn, sentence))) want.current = null;
  };
  const current = editing ? area.activities.find(a => a.id === editing.id) : undefined;
  const facts = (a: DialogueActivity) =>
    [a.owner ?? 'Ingen ansvarig', a.dueOn ? `senast ${dayText(a.dueOn)}` : 'inget slutdatum'].join(' · ');
  const row = (a: DialogueActivity) => (
    <ListItem
      key={a.id}
      align="start"
      label={<Text>{a.text}</Text>}
      description={
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="supporting">{facts(a)}</Text>
            {!a.doneAt && a.dueOn && a.dueOn < day && <Badge variant="error" label="Försenad" />}
          </HStack>
          {a.doneAt && (
            <Text type="supporting">
              Klar {instantText(a.doneAt)}
              {a.doneNote ? `: ${a.doneNote}` : ''}
            </Text>
          )}
        </VStack>
      }
      endContent={
        data.writable ? (
          a.doneAt ? (
            <HStack gap={1} wrap="wrap">
              <Button
                ref={claim(`reopen:${a.id}`)}
                size="sm"
                variant="secondary"
                label="Öppna igen"
                aria-label={`Öppna igen: ${a.text}`}
                clickAction={() => write(`done:${a.id}`, () => api.dialogue.reopen(a.id), 'Aktiviteten är öppen igen.')}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Ta bort"
                aria-label={`Ta bort: ${a.text}`}
                onClick={() => setRemoving(a)}
              />
            </HStack>
          ) : (
            <HStack gap={1} wrap="wrap">
              <Button
                ref={claim(`done:${a.id}`)}
                size="sm"
                variant="secondary"
                label="Klar"
                aria-label={`Klar: ${a.text}`}
                aria-expanded={editing?.id === a.id && editing.mode === 'done'}
                onClick={() => setEditing({ id: a.id, mode: 'done' })}
              />
              <Button
                ref={claim(`edit:${a.id}`)}
                size="sm"
                variant="ghost"
                label="Ändra"
                aria-label={`Ändra: ${a.text}`}
                aria-expanded={editing?.id === a.id && editing.mode === 'edit'}
                onClick={() => setEditing({ id: a.id, mode: 'edit' })}
              />
            </HStack>
          )
        ) : undefined
      }
    />
  );
  return (
    <VStack gap={3} as="section" aria-labelledby={`${ids}-activities`}>
      <Heading ref={heading} tabIndex={-1} level={3} id={`${ids}-activities`}>
        Aktiviteter
      </Heading>
      <VStack gap={4}>
        {area.activities.length === 0 ? (
          <Text type="supporting">Inga aktiviteter än.</Text>
        ) : (
          <>
            {open.length > 0 && (
              <List aria-label="Öppna aktiviteter" hasDividers density="compact">
                {open.map(row)}
              </List>
            )}
            {done.length > 0 && (
              <VStack gap={1} as="section" aria-labelledby={`${ids}-done`}>
                <Heading level={4} id={`${ids}-done`}>
                  Klara
                </Heading>
                <List aria-label="Klara aktiviteter" hasDividers density="compact">
                  {done.map(row)}
                </List>
              </VStack>
            )}
          </>
        )}
      </VStack>
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      {current && editing && (
        <ChangeActivity
          key={`${editing.mode}:${current.id}`}
          activity={current}
          mode={editing.mode}
          onClose={changed => {
            setEditing(null);
            // Back to the control that opened the form, or to its successor once the activity is done.
            want.current =
              changed && editing.mode === 'done' ? `reopen:${current.id}` : `${editing.mode}:${current.id}`;
          }}
        />
      )}
      {data.writable && <AddActivity unitId={data.unit.id} area={area} relation={data.unit.relation} />}
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={isOpen => {
          if (!isOpen) setRemoving(null);
        }}
        title="Ta bort aktiviteten"
        description="Aktiviteten och dess notering försvinner ur dialogen. Det går inte att ångra."
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={action.busy}
        onAction={() => {
          const a = removing;
          if (!a) return;
          void action
            .run(() => api.dialogue.remove(a.id), 'Aktiviteten är borttagen.')
            .then(ok => {
              if (!ok) return;
              setRemoved(true);
              setRemoving(null);
            });
        }}
      />
    </VStack>
  );
}

/**
 * Marking an activity done with an optional note, or changing its text and date. The form takes the focus when it opens;
 * Avbryt and a finished change give it back to the control that opened it.
 */
function ChangeActivity({
  activity,
  mode,
  onClose,
}: {
  activity: DialogueActivity;
  mode: 'done' | 'edit';
  onClose: (changed: boolean) => void;
}) {
  const action = useDialogueAction();
  const [note, setNote] = useState('');
  const [text, setText] = useState(activity.text);
  const [dueOn, setDueOn] = useState<string | undefined>(activity.dueOn);
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);
  const trimmed = text.trim();
  const textProblem =
    mode === 'edit'
      ? !trimmed
        ? 'Skriv vad som ska göras.'
        : trimmed.length > DIALOGUE_TEXT_MAX.activity
          ? `Högst ${DIALOGUE_TEXT_MAX.activity} tecken.`
          : null
      : note.trim().length > DIALOGUE_TEXT_MAX.note
        ? `Högst ${DIALOGUE_TEXT_MAX.note} tecken.`
        : null;
  const submit = async () => {
    if (action.busy) return;
    if (textProblem) {
      setTried(true);
      first.current?.focus();
      return;
    }
    const ok =
      mode === 'done'
        ? await action.run(
            () => api.dialogue.complete(activity.id, note.trim() ? { note: note.trim() } : {}),
            'Aktiviteten är klar.',
          )
        : await action.run(
            () => api.dialogue.editActivity(activity.id, { text: trimmed, dueOn: dueOn ?? null }),
            'Aktiviteten är ändrad.',
          );
    if (ok) onClose(true);
  };
  const status = tried && textProblem ? { status: { type: 'error' as const, message: textProblem } } : {};
  return (
    <VStack
      gap={3}
      as="form"
      aria-label={mode === 'done' ? 'Markera aktiviteten som klar' : 'Ändra aktiviteten'}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <Heading level={4}>{mode === 'done' ? 'Markera som klar' : 'Ändra aktiviteten'}</Heading>
      {mode === 'done' && <Text>{activity.text}</Text>}
      <FormLayout defaultOptionality="required">
        {mode === 'done' ? (
          <TextArea
            ref={first}
            label="Hur gick det"
            isOptional
            value={note}
            onChange={setNote}
            rows={2}
            maxLength={DIALOGUE_TEXT_MAX.note}
            {...status}
          />
        ) : (
          <>
            <TextArea
              ref={first}
              label="Vad ska göras"
              value={text}
              onChange={setText}
              rows={3}
              maxLength={DIALOGUE_TEXT_MAX.activity}
              {...status}
            />
            <DateInput
              label="Klart senast"
              isOptional
              value={dueOn as never}
              onChange={value => setDueOn(value ?? undefined)}
              weekStartsOn="mon"
              placeholder="Inget datum"
              presentation="adaptive-bottom-sheet"
            />
          </>
        )}
      </FormLayout>
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      <HStack gap={2}>
        <Button
          type="submit"
          variant="primary"
          label={mode === 'done' ? 'Markera klar' : 'Spara'}
          isLoading={action.busy}
        />
        <Button variant="secondary" label="Avbryt" onClick={() => onClose(false)} />
      </HStack>
    </VStack>
  );
}

/**
 * Adding an activity: what is to be done and, if it has one, the day it is due. It goes to the unit's manager as a card:
 * the reader on their own unit, the manager who reports to them on a unit below. What is missing is said on the field;
 * on success the fields empty and the focus goes back to the text, ready for the next one.
 */
function AddActivity({
  unitId,
  area,
  relation,
}: {
  unitId: string;
  area: DialogueArea;
  relation: DialogueUnit['unit']['relation'];
}) {
  const ids = useId();
  const add = useDialogueAction();
  const [text, setText] = useState('');
  const [dueOn, setDueOn] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const textField = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const problem = !trimmed
    ? 'Skriv vad som ska göras.'
    : trimmed.length > DIALOGUE_TEXT_MAX.activity
      ? `Högst ${DIALOGUE_TEXT_MAX.activity} tecken.`
      : null;
  const submit = async () => {
    if (add.busy) return;
    if (problem) {
      setTried(true);
      textField.current?.focus();
      return;
    }
    const ok = await add.run(
      () => api.dialogue.addActivity(unitId, { area: area.key, text: trimmed, ...(dueOn ? { dueOn } : {}) }),
      'Aktiviteten är tillagd.',
    );
    if (!ok) return;
    setText('');
    setDueOn(undefined);
    setTried(false);
    textField.current?.focus();
  };
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
      <Heading level={4} id={`${ids}-add`}>
        Ny aktivitet
      </Heading>
      <Text type="supporting">
        {relation === 'own'
          ? 'Aktiviteten blir din och hamnar i Att göra.'
          : 'Aktiviteten går till enhetens chef och hamnar i deras Att göra.'}
      </Text>
      <FormLayout defaultOptionality="required">
        <TextArea
          ref={textField}
          label="Vad ska göras"
          value={text}
          onChange={setText}
          rows={3}
          maxLength={DIALOGUE_TEXT_MAX.activity}
          {...(tried && problem ? { status: { type: 'error' as const, message: problem } } : {})}
        />
        <DateInput
          label="Klart senast"
          isOptional
          value={dueOn as never}
          onChange={value => setDueOn(value ?? undefined)}
          min={today() as never}
          weekStartsOn="mon"
          placeholder="Inget datum"
          presentation="adaptive-bottom-sheet"
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
