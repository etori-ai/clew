import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DIALOGUE_TEXT_MAX,
  type DialogueActivity,
  type DialogueArea,
  type DialogueAssessment,
  type DialogueDimension,
  type DialogueNote,
  type DialogueTone,
  type DialogueUnit,
} from '@clew/contracts';
import {
  AlertDialog,
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
  StatusDot,
  Tab,
  TabList,
  Text,
  TextArea,
  VStack,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../../api';
import { dialogueQuery, entityDetailQuery, entitySectionQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { useDialogueAction } from '../../mutations';
import { ContentSkeleton } from '../shell/loading';
import { StateWords, measureOf, summaryOf } from './unit-figures';
import { fieldText } from '../views/view';

/** The words of a state, as the server's `TONE_WORDS`; the colour is never alone. */
const TONE: Record<
  DialogueTone,
  { label: string; variant: 'success' | 'warning' | 'error'; dot: 'success' | 'warning' | 'error' }
> = {
  ok: { label: 'Bra', variant: 'success', dot: 'success' },
  warn: { label: 'Bevaka', variant: 'warning', dot: 'warning' },
  alert: { label: 'Åtgärd krävs', variant: 'error', dot: 'error' },
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
 * One unit's follow-up dialogue (D118) as the dialogue's tab on the unit's page (D126 rule 3: the drawer that lay over
 * the page is gone; the dialogue is where the unit is). The address is the unit's page with the dialogue's source as
 * `section` (`person-address.ts`); an address that laid the drawer over the page (`?dialog=<unitId>`) leads here. Nothing
 * is read until the tab is shown.
 *
 * The areas are tabs; each shows its figure or its assessment per dimension with the history, the questions to talk
 * about, the activities with a form to add one, and the reader's own notes (D120), which nobody else sees. A refusal (the
 * module switched off, a unit the reader does not follow up) is the dialogue that is not there.
 */
export function DialogueTab({ unitId }: { unitId: string }) {
  const read = useQuery(dialogueQuery(unitId));
  const data = read.data;
  if (read.isError)
    return (
      <Banner
        status="error"
        title={errorMessage(read.error, 'Uppföljningsdialogen kunde inte hämtas.')}
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
    );
  if (data === undefined) return <ContentSkeleton label="Hämtar uppföljningsdialogen …" rows={4} heading={false} />;
  // `null`: the module is off for the reader, or the unit is not one they follow up.
  if (data === null || data.unit.id !== unitId)
    return (
      <EmptyState
        isCompact
        headingLevel={3}
        title="Uppföljningsdialogen finns inte"
        description="Enheten finns inte bland dem du följer upp, eller så är dialogstödet avstängt."
      />
    );
  return data.areas.length ? (
    <Dialogue key={data.unit.id} data={data} />
  ) : (
    <EmptyState
      isCompact
      headingLevel={3}
      title="Uppföljningsdialogen har inga områden än"
      description="Ingen har lagt in områdena och frågorna för uppföljningsdialogen."
    />
  );
}

const WEIGHT: Record<DialogueTone, number> = { ok: 0, warn: 1, alert: 2 };
/** The area to open on: the one that needs action, else the one to watch, else the first. */
const startArea = (areas: DialogueArea[]) =>
  [...areas].sort((a, b) => (b.tone ? WEIGHT[b.tone] : -1) - (a.tone ? WEIGHT[a.tone] : -1))[0]!;

/**
 * The areas as tabs, each with its state as a dot whose name is the word (so a tab reads "Verksamhet, Åtgärd krävs"),
 * opened on the area that needs a conversation most. Every area's panel stays mounted and hidden until found while
 * another is shown, so text being written survives a change of tab, every tab's `aria-controls` names a panel that
 * exists, and find in page searches every area.
 */
function Dialogue({ data }: { data: DialogueUnit }) {
  const ids = useId();
  const [areaKey, setAreaKey] = useState(() => startArea(data.areas).key);
  const area = data.areas.find(a => a.key === areaKey) ?? data.areas[0]!;
  const panelId = (key: string) => `${ids}-panel-${key}`;
  // The other areas' panels are hidden until found, so the browser's find in page reaches their questions and
  // activities; when it reveals one, its tab is selected so the tabs and the panel agree.
  const panels = useRef(new Map<string, HTMLDivElement>());
  const panel = (key: string) => (el: HTMLDivElement | null) => {
    if (el) panels.current.set(key, el);
    else panels.current.delete(key);
  };
  // React 19 writes `hidden` as a boolean and drops the platform's `until-found`, so the panels' hiding is set on the
  // elements themselves, before paint, and React never renders the attribute.
  useLayoutEffect(() => {
    for (const [key, el] of panels.current)
      if (key === area.key) el.removeAttribute('hidden');
      else el.setAttribute('hidden', 'until-found');
  }, [area.key, data.areas]);
  useEffect(() => {
    const off = [...panels.current].map(([key, el]) => {
      const reveal = () => setAreaKey(key);
      el.addEventListener('beforematch', reveal);
      return () => el.removeEventListener('beforematch', reveal);
    });
    return () => off.forEach(stop => stop());
  }, [data.areas]);
  return (
    <VStack gap={4}>
      <TabList value={area.key} onChange={setAreaKey} role="tablist" size="sm" hasDivider aria-label="Områden">
        {data.areas.map(a => (
          <Tab
            key={a.key}
            value={a.key}
            label={a.title}
            panelId={panelId(a.key)}
            {...(a.tone ? { endContent: <StatusDot variant={TONE[a.tone].dot} label={TONE[a.tone].label} /> } : {})}
          />
        ))}
      </TabList>
      {/* One block without a gap: a panel hidden until found still takes part in the layout, so a gap between panels
          would add space for every hidden one. */}
      <div>
        {data.areas.map(a => (
          <div key={a.key} ref={panel(a.key)} id={panelId(a.key)} role="tabpanel" aria-label={a.title}>
            <AreaPanel area={a} data={data} />
          </div>
        ))}
      </div>
    </VStack>
  );
}

/**
 * One area as the conversation runs: where it stands (the figure, or the state per dimension with who set it), what to
 * talk about, then what the managers agree: a new assessment and the activities. The forms open from their buttons, so
 * the panel reads as an agenda until something is to be written down.
 */
function AreaPanel({ area, data }: { area: DialogueArea; data: DialogueUnit }) {
  const ids = useId();
  const [assessing, setAssessing] = useState(false);
  const [adding, setAdding] = useState(false);
  const assessButton = useRef<HTMLButtonElement>(null);
  const open = area.activities.filter(a => !a.doneAt).length,
    done = area.activities.length - open;
  const needs = area.tone === 'alert' || area.tone === 'warn';
  return (
    <VStack gap={6}>
      <VStack gap={3} as="section" aria-labelledby={`${ids}-state`}>
        <Heading level={3} id={`${ids}-state`}>
          Läget
        </Heading>
        {area.kind === 'measured' ? (
          area.measure ? (
            <MeasuredFigure unitId={data.unit.id} capability={area.measure} />
          ) : null
        ) : (
          area.dimensions.map(d => <Dimension key={d.key} area={area} dimension={d} />)
        )}
        {area.info && <Text type="supporting">{area.info}</Text>}
        {needs && data.writable && open === 0 && (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text>
              {done
                ? 'Aktiviteterna är klara. Gör en ny bedömning om läget har ändrats.'
                : 'Ingen aktivitet svarar på läget än.'}
            </Text>
            {!done && !adding && (
              <Button size="sm" variant="secondary" label="Lägg till aktivitet" onClick={() => setAdding(true)} />
            )}
          </HStack>
        )}
      </VStack>
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
                label={q.heading ? <Text weight="semibold">{q.heading}</Text> : <Text>{q.text}</Text>}
                {...(q.heading || q.basedOn
                  ? {
                      description: (
                        <VStack gap={1}>
                          {q.heading && <Text>{q.text}</Text>}
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
      {area.kind === 'assessed' && data.writable && (
        <VStack gap={3} as="section" aria-labelledby={`${ids}-assess`}>
          <Heading level={3} id={`${ids}-assess`}>
            Bedömning
          </Heading>
          {assessing ? (
            <AssessForm
              unitId={data.unit.id}
              area={area}
              onClose={() => {
                setAssessing(false);
                requestAnimationFrame(() => assessButton.current?.focus());
              }}
            />
          ) : (
            <HStack>
              <Button
                ref={assessButton}
                variant="secondary"
                label="Ny bedömning"
                aria-label={`Ny bedömning av ${area.title}`}
                onClick={() => setAssessing(true)}
              />
            </HStack>
          )}
        </VStack>
      )}
      <Activities area={area} data={data} adding={adding} setAdding={setAdding} />
      {data.writable && <Notes area={area} unitId={data.unit.id} />}
    </VStack>
  );
}

/**
 * A measured area's figure for the unit, drawn as the unit's page draws its key figures: what is measured, the value
 * large, its state, and where it comes from.
 */
function MeasuredFigure({ unitId, capability }: { unitId: string; capability: string }) {
  const detail = useQuery(entityDetailQuery('unit', unitId));
  const source = detail.data?.sections.find(s => s.capability === capability);
  const key = detail.data?.entity.key ?? unitId;
  const section = useQuery({ ...entitySectionQuery('unit', key, capability), enabled: !!source });
  if (detail.isPending || (source && section.isPending))
    return <ContentSkeleton label="Hämtar nyckeltalet …" rows={1} heading={false} />;
  const row = section.data?.status === 'ok' ? section.data.row : undefined;
  if (!source || !row) return <Text type="supporting">Nyckeltalet finns inte för enheten just nu.</Text>;
  const { title, state, tone } = summaryOf(source, row);
  return (
    <VStack gap={2}>
      <Text type="supporting">
        {measureOf(source)} · {source.source}
      </Text>
      {title && (
        <Text type="display-3" hasTabularNumbers>
          {fieldText(title, row[title.key])}
        </Text>
      )}
      {state && <StateWords field={state} value={row[state.key]} tone={tone} />}
    </VStack>
  );
}

/** "Ingrid Holm · 13 nov 2026" under a state. */
const byline = (a: DialogueAssessment) => [a.by, instantText(a.at)].filter(Boolean).join(' · ');

/** One dimension of an assessed area: its state now with who set it and why, then the earlier states. */
function Dimension({ area, dimension }: { area: DialogueArea; dimension: DialogueDimension }) {
  const ids = useId();
  const [latest, ...earlier] = dimension.history;
  const heading = dimension.title || area.title;
  const state = latest ? (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge variant={TONE[latest.tone].variant} label={TONE[latest.tone].label} />
        <Text type="supporting">{byline(latest)}</Text>
      </HStack>
      {latest.comment && <Text>{latest.comment}</Text>}
    </VStack>
  ) : (
    <Text type="supporting">Inte bedömd än.</Text>
  );
  const history = earlier.length > 0 && (
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
  );
  // An area assessed as a whole has no heading of its own: "Läget" above it already names it.
  return dimension.title ? (
    <VStack gap={2} as="section" aria-labelledby={`${ids}-dim`}>
      <Heading level={4} id={`${ids}-dim`}>
        {heading}
      </Heading>
      {state}
      {history}
    </VStack>
  ) : (
    <VStack gap={2}>
      {state}
      {history}
    </VStack>
  );
}

/**
 * A new assessment of an area: which part where the area has parts, the state, an optional comment, Spara. The part and
 * the state are required. It takes the focus when it opens; Avbryt and a saved assessment give it back to "Ny bedömning".
 */
function AssessForm({ unitId, area, onClose }: { unitId: string; area: DialogueArea; onClose: () => void }) {
  const action = useDialogueAction();
  const parts = area.dimensions.filter(d => d.key);
  const [dimension, setDimension] = useState(parts.length === 1 ? parts[0]!.key : '');
  const [tone, setTone] = useState<DialogueTone | ''>('');
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => first.current?.querySelector<HTMLInputElement>('input')?.focus(), []);
  const dimensionProblem = parts.length && !dimension ? 'Välj vilken del bedömningen gäller.' : null;
  const toneProblem = tone ? null : 'Välj ett läge.';
  const commentProblem =
    comment.trim().length > DIALOGUE_TEXT_MAX.comment ? `Högst ${DIALOGUE_TEXT_MAX.comment} tecken.` : null;
  const title = parts.find(d => d.key === dimension)?.title ?? area.title;
  const submit = async () => {
    if (action.busy) return;
    if (dimensionProblem || toneProblem || commentProblem) {
      setTried(true);
      return;
    }
    const ok = await action.run(
      () =>
        api.dialogue.assess(unitId, {
          area: area.key,
          ...(dimension ? { dimension } : {}),
          tone: tone as DialogueTone,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      `Bedömningen av ${title} är sparad.`,
    );
    if (ok) onClose();
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  return (
    <VStack
      ref={first}
      gap={3}
      as="form"
      aria-label={`Ny bedömning av ${area.title}`}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormLayout defaultOptionality="required">
        {parts.length > 1 && (
          <RadioList label="Del" value={dimension} onChange={setDimension} {...status(dimensionProblem)}>
            {parts.map(d => (
              <RadioListItem key={d.key} value={d.key} label={d.title} />
            ))}
          </RadioList>
        )}
        <RadioList
          label="Läge"
          value={tone}
          onChange={value => setTone(value as DialogueTone)}
          orientation="horizontal"
          {...status(toneProblem)}
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
          {...status(commentProblem)}
        />
      </FormLayout>
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      <HStack gap={2}>
        <Button type="submit" variant="primary" label="Spara bedömning" isLoading={action.busy} />
        <Button variant="secondary" label="Avbryt" onClick={onClose} />
      </HStack>
    </VStack>
  );
}

type Editing = { id: string; mode: 'done' | 'edit' } | null;

/** The area's activities: the open ones first, then the done ones; each with what can be done to it; a form to add one. */
function Activities({
  area,
  data,
  adding,
  setAdding,
}: {
  area: DialogueArea;
  data: DialogueUnit;
  adding: boolean;
  setAdding: (adding: boolean) => void;
}) {
  const ids = useId();
  const addButton = useRef<HTMLButtonElement>(null);
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
              <VStack gap={1} as="section" aria-labelledby={`${ids}-open`}>
                <Heading level={4} id={`${ids}-open`}>
                  Öppna
                </Heading>
                <List aria-label="Öppna aktiviteter" hasDividers density="compact">
                  {open.map(row)}
                </List>
              </VStack>
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
      {data.writable &&
        (adding ? (
          <AddActivity
            unitId={data.unit.id}
            area={area}
            relation={data.unit.relation}
            onClose={() => {
              setAdding(false);
              requestAnimationFrame(() => addButton.current?.focus());
            }}
          />
        ) : (
          <HStack>
            <Button
              ref={addButton}
              variant="secondary"
              label="Lägg till aktivitet"
              aria-label={`Lägg till aktivitet i ${area.title}`}
              onClick={() => setAdding(true)}
            />
          </HStack>
        ))}
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
  onClose,
}: {
  unitId: string;
  area: DialogueArea;
  relation: DialogueUnit['unit']['relation'];
  onClose: () => void;
}) {
  const ids = useId();
  const add = useDialogueAction();
  const [text, setText] = useState('');
  const [dueOn, setDueOn] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const textField = useRef<HTMLTextAreaElement>(null);
  // Opened from its button: the text takes the focus at once.
  useEffect(() => textField.current?.focus(), []);
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
      <HStack gap={2}>
        <Button type="submit" variant="primary" label="Lägg till" isLoading={add.busy} />
        <Button variant="secondary" label="Stäng" onClick={onClose} />
      </HStack>
    </VStack>
  );
}

/**
 * The reader's own notes on the area (D120): thoughts and observations in free text that follow the unit between the
 * conversations. Nobody else sees them, and the section says so. Looser than an activity: nothing to mark done, and a
 * note is removed for good behind a confirmation. The newest first; the form opens from its button, as the others do.
 */
function Notes({ area, unitId }: { area: DialogueArea; unitId: string }) {
  const ids = useId();
  const action = useDialogueAction();
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DialogueNote | null>(null);
  // A removed note takes the control that opened the confirmation with it: the focus goes to the section's heading (2.4.3).
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
  // The control that should hold the focus once it is drawn again: the one that opened the form.
  const want = useRef<string | null>(null);
  const claim = (key: string) => (el: HTMLElement | null) => {
    if (el && want.current === key) {
      want.current = null;
      el.focus();
    }
  };
  const current = editing ? area.notes.find(n => n.id === editing) : undefined;
  const when = (n: DialogueNote) =>
    n.editedAt ? `${instantText(n.createdAt)} · ändrad ${instantText(n.editedAt)}` : instantText(n.createdAt);
  return (
    <VStack gap={3} as="section" aria-labelledby={`${ids}-notes`}>
      <VStack gap={1}>
        <Heading ref={heading} tabIndex={-1} level={3} id={`${ids}-notes`}>
          Mina anteckningar
        </Heading>
        <Text type="supporting">Bara du ser dem. De följer enheten mellan samtalen.</Text>
      </VStack>
      {area.notes.length === 0 ? (
        <Text type="supporting">Inga anteckningar än.</Text>
      ) : (
        <List aria-label="Mina anteckningar" hasDividers density="compact">
          {area.notes.map(n => (
            <ListItem
              key={n.id}
              align="start"
              label={<Text>{n.text}</Text>}
              description={<Text type="supporting">{when(n)}</Text>}
              endContent={
                <HStack gap={1} wrap="wrap">
                  <Button
                    ref={claim(`edit:${n.id}`)}
                    size="sm"
                    variant="secondary"
                    label="Ändra"
                    aria-label={`Ändra anteckningen från ${instantText(n.createdAt)}`}
                    aria-expanded={editing === n.id}
                    onClick={() => setEditing(n.id)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Ta bort"
                    aria-label={`Ta bort anteckningen från ${instantText(n.createdAt)}`}
                    onClick={() => setRemoving(n)}
                  />
                </HStack>
              }
            />
          ))}
        </List>
      )}
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      {current && (
        <NoteForm
          key={current.id}
          unitId={unitId}
          area={area}
          note={current}
          onClose={() => {
            setEditing(null);
            want.current = `edit:${current.id}`;
          }}
        />
      )}
      {adding ? (
        <NoteForm
          unitId={unitId}
          area={area}
          onClose={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      ) : (
        <HStack>
          <Button
            ref={addButton}
            variant="secondary"
            label="Ny anteckning"
            aria-label={`Ny anteckning om ${area.title}`}
            onClick={() => setAdding(true)}
          />
        </HStack>
      )}
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={isOpen => {
          if (!isOpen) setRemoving(null);
        }}
        title="Ta bort anteckningen"
        description="Anteckningen tas bort för gott. Det går inte att ångra."
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={action.busy}
        onAction={() => {
          const n = removing;
          if (!n) return;
          void action
            .run(() => api.dialogue.removeNote(n.id), 'Anteckningen är borttagen.')
            .then(ok => {
              if (!ok) return;
              if (editing === n.id) setEditing(null);
              setRemoved(true);
              setRemoving(null);
            });
        }}
      />
    </VStack>
  );
}

/**
 * Writing a note or changing one. The text takes the focus when the form opens. A new note saved empties the field and
 * keeps the focus there, ready for the next thought; a changed one closes the form and gives the focus back to "Ändra".
 */
function NoteForm({
  unitId,
  area,
  note,
  onClose,
}: {
  unitId: string;
  area: DialogueArea;
  note?: DialogueNote;
  onClose: () => void;
}) {
  const ids = useId();
  const action = useDialogueAction();
  const [text, setText] = useState(note?.text ?? '');
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const trimmed = text.trim();
  const problem = !trimmed
    ? 'Skriv din anteckning.'
    : trimmed.length > DIALOGUE_TEXT_MAX.ownNote
      ? `Högst ${DIALOGUE_TEXT_MAX.ownNote} tecken.`
      : null;
  const submit = async () => {
    if (action.busy) return;
    if (problem) {
      setTried(true);
      field.current?.focus();
      return;
    }
    if (note) {
      if (await action.run(() => api.dialogue.editNote(note.id, { text: trimmed }), 'Anteckningen är ändrad.'))
        onClose();
      return;
    }
    const ok = await action.run(
      () => api.dialogue.addNote(unitId, { area: area.key, text: trimmed }),
      'Anteckningen är sparad.',
    );
    if (!ok) return;
    setText('');
    setTried(false);
    field.current?.focus();
  };
  return (
    <VStack
      gap={3}
      as="form"
      aria-labelledby={`${ids}-note`}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <Heading level={4} id={`${ids}-note`}>
        {note ? 'Ändra anteckningen' : 'Ny anteckning'}
      </Heading>
      <FormLayout defaultOptionality="required">
        <TextArea
          ref={field}
          label="Anteckning"
          description="Tankar, iakttagelser och underlag i fri form."
          value={text}
          onChange={setText}
          rows={4}
          maxLength={DIALOGUE_TEXT_MAX.ownNote}
          {...(tried && problem ? { status: { type: 'error' as const, message: problem } } : {})}
        />
      </FormLayout>
      {action.error && (
        <Text as="p" role="alert" color="accent">
          {action.error}
        </Text>
      )}
      <HStack gap={2}>
        <Button type="submit" variant="primary" label="Spara" isLoading={action.busy} />
        <Button variant="secondary" label={note ? 'Avbryt' : 'Stäng'} onClick={onClose} />
      </HStack>
    </VStack>
  );
}
