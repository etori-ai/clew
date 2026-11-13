import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Ask, AskValues, CardAction, EntityAction, EntityKind, Thread } from '@clew/contracts';
import {
  Banner,
  Button,
  DateInput,
  DayStrip,
  Dialog,
  DialogHeader,
  EventList,
  Field,
  FieldStatus,
  FormLayout,
  HStack,
  Heading,
  LayoutHeader,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  RadioList,
  RadioListItem,
  Selector,
  Skeleton,
  Step,
  Stepper,
  Text,
  TextArea,
  TextInput,
  TimeInput,
  VStack,
  agendaItems,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { dayLabel, displayDate } from '@clew/calendar/dates';
import {
  askProblems,
  blockedText,
  clashes,
  dayWords,
  fillInLabel,
  firstStep,
  isInstant,
  meetingEnd,
  meetingParts,
  meetingStart,
  refusalProperty,
  sentValues,
  slotText,
  stepsOf,
  valueText,
  type ActionStep,
} from '../action-path';
import { confirmParts } from '../confirm-parts';
import { mobileQuery } from '../media';
import { actionEffectQuery, meetingTimesQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { DialogFrame } from './dialog-frame';

/**
 * The action dialog (D112 item 10, the `form-wizard-dialog` template, boards ActBook and ActEffect): the one path a
 * write passes, from every place its button is drawn. "Uppgifter" asks what the capability's `asks` say and the action
 * does not already give, one Astryx field per ask; "Det här händer", always last, lists the values and what will be
 * written where (the connector's `effect` read for exactly those values, else its system and the capability's
 * description). Nothing is sent before the last button, whose label is the action's own. A refusal from the server is
 * placed on the field it concerns, else at the top of the step, and the focus goes to it. ✕, Esc and Avbryt send
 * nothing; the values stay with the caller (`values`) while the work item stays open. On a phone the dialog fills the
 * screen with its buttons pinned at the foot, as the template's frame keeps them.
 */
export type ActionTarget =
  /** An action on a work item: its effect is read and its decision sent on the item, with the rows chosen there. */
  | { kind: 'item'; thread: Thread; action: CardAction; refs?: string[] }
  /** An action about a person or a unit before any work item exists: a propose, which drafts the item with the values. */
  | { kind: 'entity'; entity: { kind: EntityKind; key: string; name: string }; action: EntityAction };
export interface ActionDialogProps {
  target: ActionTarget;
  isOpen: boolean;
  /** ✕, Esc or Avbryt: nothing is sent. Also called with false by the caller's own send once it went through. */
  onOpenChange: (open: boolean) => void;
  /**
   * The step to open at: `fill-in` ("Ändra" on an assistant's draft) or `effect` ("Granska och …"). An `effect` start
   * whose values do not pass opens at the fill-in with the problems shown. Without it a path that requires nothing opens
   * at "Det här händer" and one that requires an answer at the fill-in.
   */
  startAt?: ActionStep;
  /** The values to start from when the caller does not hold them (`values`), such as an assistant's filled-in draft. */
  initialValues?: AskValues;
  /** The values typed so far, held by the caller so a closed and reopened dialog keeps them; with `onValuesChange`. */
  values?: AskValues;
  onValuesChange?: (values: AskValues) => void;
  /**
   * Sends the decision with the values as the server takes them (trimmed, empty optional answers left out). Resolves
   * null once it went through (the caller closes the dialog), or the server's Swedish refusal, which the dialog places.
   */
  onSend: (values: AskValues) => Promise<string | null>;
}

/** What one step needs beside the other for its marker and its longest label, "Det här händer", to be drawn whole. */
const STEP_WIDTH = 160;
type Labels = { label: string; source: string; about: string; capability: string; before: string | null };
const labelsOf = (target: ActionTarget): Labels =>
  target.kind === 'item'
    ? {
        label: target.action.label,
        source: target.thread.trigger.source,
        about: target.thread.title,
        capability: target.action.capability,
        before: target.thread.deadline?.slice(0, 10) ?? null,
      }
    : {
        label: target.action.title,
        source: target.action.source,
        about: target.entity.name,
        capability: target.action.capability,
        before: null,
      };
/**
 * The control a field's problem is read from: the checked radio, else the field's own input (a date field's calendar
 * button comes before its input), else its first button.
 */
function focusField(root: HTMLElement | null, key: string) {
  const field = root?.querySelector<HTMLElement>(`[data-ask="${CSS.escape(key)}"]`);
  const target =
    field?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
    field?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea') ??
    field?.querySelector<HTMLElement>('button');
  target?.focus();
}

export function ActionDialog({
  target,
  isOpen,
  onOpenChange,
  startAt,
  initialValues,
  values: held,
  onValuesChange,
  onSend,
}: ActionDialogProps) {
  const path = target.action.path ?? { asks: [], effect: false, description: '' };
  const labels = labelsOf(target);
  const mobile = useMediaQuery(mobileQuery);
  const announce = useAnnounce();
  const [own, setOwn] = useState<AskValues>(initialValues ?? {});
  const values = held ?? own;
  const setValues = (next: AskValues) => (onValuesChange ? onValuesChange(next) : setOwn(next));
  const setValue = (property: string, value: string) => setValues({ ...values, [property]: value });
  // Where the dialog is: chosen afresh each time it opens, from the values it opens with.
  const [session, setSession] = useState(() => ({
    open: false,
    ...firstStep(path, values, new Date().toISOString(), startAt),
  }));
  const [refusal, setRefusal] = useState<{ property?: string; message: string } | null>(null);
  // The focus after a move between the steps or a refusal: a field by its key, the step's heading or the refusal.
  const [focusTo, setFocusTo] = useState<string | null>(null);
  if (session.open !== isOpen) {
    setSession(
      isOpen
        ? { open: true, ...firstStep(path, values, new Date().toISOString(), startAt) }
        : { ...session, open: false },
    );
    if (isOpen) {
      setRefusal(null);
      setFocusTo(null);
    }
  }
  const { step, attempted } = session;
  const steps = stepsOf(path);
  const root = useRef<HTMLDivElement>(null);
  const effectHeading = useRef<HTMLHeadingElement>(null);
  const effectId = useId();
  const refusalBanner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusTo) return;
    const frame = requestAnimationFrame(() => {
      if (focusTo === 'effect') effectHeading.current?.focus();
      else if (focusTo === 'refusal') refusalBanner.current?.focus();
      else focusField(root.current, focusTo);
      setFocusTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTo, step]);

  const now = new Date().toISOString();
  const problems = new Map(askProblems(path.asks, values, now));
  if (refusal?.property && !problems.has(refusal.property)) problems.set(refusal.property, refusal.message);
  const shown = (property: string) =>
    (attempted || refusal?.property === property) && problems.has(property) ? problems.get(property) : undefined;
  const sent = sentValues(path.asks, values);

  const item = target.kind === 'item' ? target : null;
  // "Det här händer" is read for exactly the values on the step, and again whenever they change.
  const effect = useQuery({
    ...actionEffectQuery(item?.thread ?? { id: '', updatedAt: '' }, item?.action.id ?? '', item?.refs, sent),
    enabled: isOpen && step === 'effect' && path.effect && !!item,
  });
  const effectAnswered = !path.effect || !item || effect.isSuccess;
  const lastFailure = useRef<string | null>(null);
  useEffect(() => {
    const failure = effect.isError ? errorMessage(effect.error, 'Det gick inte att läsa vad som händer.') : null;
    if (failure && failure !== lastFailure.current) announce(failure);
    lastFailure.current = failure;
  }, [effect.isError, effect.error, announce]);

  /** The key of the control a property's problem is placed on: a meeting asked as "Annan tid" has a date and a clock. */
  const meetingKeys = useRef(new Map<string, () => string>());
  const fieldKey = (property: string) => meetingKeys.current.get(property)?.() ?? property;
  const close = () => onOpenChange(false);
  const toEffect = () => {
    setSession(s => ({ ...s, attempted: true }));
    const first = askProblems(path.asks, values, now)[0];
    if (first) {
      // The fields say their own problems as they appear; a repeated attempt with the same problems is said once more.
      if (attempted) announce(first[1], 'assertive');
      setFocusTo(fieldKey(first[0]));
      return;
    }
    setRefusal(null);
    setSession(s => ({ ...s, step: 'effect' }));
    setFocusTo('effect');
  };
  const toFillIn = () => {
    setSession(s => ({ ...s, step: 'fill-in' }));
    setFocusTo(fieldKey(path.asks[0]?.property ?? ''));
  };
  // Sent from onClick, not Astryx's clickAction: a transition would hold the caller's close until the answer has come,
  // and the dialog closes first so the focus is back on the pressed button before the item shows the answer.
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!effectAnswered || sending) return;
    const first = askProblems(path.asks, values, new Date().toISOString())[0];
    if (first) {
      setSession({ open: true, step: 'fill-in', attempted: true });
      setFocusTo(fieldKey(first[0]));
      return;
    }
    setSending(true);
    const message = await onSend(sent).finally(() => setSending(false));
    if (message === null) return;
    const property = refusalProperty(path.asks, message);
    setRefusal({ ...(property ? { property } : {}), message });
    if (property) {
      setSession({ open: true, step: 'fill-in', attempted: true });
      setFocusTo(fieldKey(property));
    } else {
      // The banner mounts with its words, which not every screen reader says (4.1.3): said aloud as well.
      announce(message, 'assertive');
      setFocusTo('refusal');
    }
  };

  const size = mobile ? 'lg' : 'md';
  const sendButton = (
    <Button
      size={size}
      variant="primary"
      label={labels.label}
      isDisabled={!effectAnswered}
      isLoading={sending}
      onClick={() => void send()}
    />
  );
  const cancel = <Button size={size} variant="secondary" label="Avbryt" onClick={close} />;
  const missing = attempted ? askProblems(path.asks, values, now).length : 0;
  const footer =
    step === 'fill-in'
      ? {
          secondary: <Text type="supporting">Inget skickas i det här steget.</Text>,
          primary: (
            <>
              {missing > 0 && <FieldStatus type="error" variant="detached" message={blockedText(missing)} />}
              {cancel}
              <Button size={size} variant="primary" label="Nästa" onClick={toEffect} />
            </>
          ),
        }
      : {
          secondary: steps.length > 1 && (
            <Button size={size} variant="secondary" label={fillInLabel(path.asks, values)} onClick={toFillIn} />
          ),
          primary: (
            <>
              {cancel}
              {sendButton}
            </>
          ),
        };
  const header = (
    <>
      <DialogHeader
        title={labels.label}
        subtitle={`${labels.source}\u00a0· ${labels.about}`}
        onOpenChange={open => {
          if (!open) close();
        }}
        hasDivider={false}
      />
      {steps.length > 1 && (
        <LayoutHeader hasDivider={false}>
          {/* A position indicator, not a way to move: the footer's buttons are the whole navigation (the template). Where
              a step's label would be cut short (320 px, 1.4.10) the track drops the labels and says the step's name
              under it, the footer's buttons being the controls. */}
          <Stepper
            activeStep={steps.indexOf(step)}
            orientation="horizontal"
            density="compact"
            label="Steg"
            horizontalOptions={{ minimumStepWidth: STEP_WIDTH, collapsedVariant: 'withLabel' }}
          >
            <Step step={0} label="Uppgifter" status={attempted && problems.size > 0 ? 'error' : undefined} />
            <Step step={1} label="Det här händer" />
          </Stepper>
        </LayoutHeader>
      )}
    </>
  );
  const confirm = 'confirm' in target.action && target.action.confirm ? confirmParts(target.action) : null;
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) close();
      }}
      width={620}
      variant={mobile ? 'fullscreen' : 'standard'}
      purpose="form"
    >
      <DialogFrame header={header} error={null} secondary={footer.secondary} primary={footer.primary}>
        <VStack ref={root} gap={5}>
          {refusal && !refusal.property && (
            <Banner
              ref={refusalBanner}
              tabIndex={-1}
              role="alert"
              status="error"
              title={refusal.message}
              collapsible={false}
            />
          )}
          {step === 'fill-in' ? (
            <FormLayout defaultOptionality="optional">
              {path.asks.map(ask => (
                <AskField
                  key={ask.property}
                  ask={ask}
                  value={values[ask.property] ?? ''}
                  onChange={value => {
                    setValue(ask.property, value);
                    if (refusal?.property === ask.property) setRefusal(null);
                  }}
                  problem={shown(ask.property)}
                  labels={labels}
                  isOpen={isOpen && step === 'fill-in'}
                  mobile={mobile}
                  keys={meetingKeys.current}
                />
              ))}
            </FormLayout>
          ) : (
            <VStack gap={5}>
              {path.asks.some(a => sent[a.property]) && (
                <MetadataList columns="single">
                  {path.asks
                    .filter(a => sent[a.property])
                    .map(a => (
                      <MetadataListItem key={a.property} label={a.label}>
                        <Text>{valueText(a, sent[a.property]!)}</Text>
                      </MetadataListItem>
                    ))}
                </MetadataList>
              )}
              <VStack as="section" gap={3} aria-labelledby={effectId}>
                <Heading ref={effectHeading} tabIndex={-1} level={3} id={effectId}>
                  {`När du trycker ${labels.label}`}
                </Heading>
                {path.effect && item ? (
                  effect.isPending ? (
                    <VStack gap={2} aria-busy="true">
                      <Text type="supporting" role="status">
                        {`Frågar ${labels.source} vad som händer …`}
                      </Text>
                      <Skeleton height={20} width="70%" />
                      <Skeleton height={20} width="50%" />
                    </VStack>
                  ) : effect.isError ? (
                    <VStack gap={2}>
                      <Text as="p">{errorMessage(effect.error, 'Det gick inte att läsa vad som händer.')}</Text>
                      <HStack>
                        <Button
                          size={size}
                          variant="secondary"
                          label="Försök igen"
                          isLoading={effect.isFetching}
                          onClick={() => void effect.refetch()}
                        />
                      </HStack>
                    </VStack>
                  ) : (
                    <>
                      <EffectRows rows={effect.data.rows} source={effect.data.source} />
                      {effect.data.undoMinutes !== undefined && (
                        <Banner
                          status="info"
                          title={`Du kan ångra i ${effect.data.undoMinutes} minuter.`}
                          collapsible={false}
                        />
                      )}
                    </>
                  )
                ) : (
                  <EffectRows rows={[{ label: path.description }]} source={labels.source} />
                )}
                {confirm && (
                  <Banner
                    status="warning"
                    title={confirm.title}
                    description={confirm.description}
                    collapsible={false}
                  />
                )}
              </VStack>
            </VStack>
          )}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/** What will be written where (board ActEffect): one row per thing, with the system it is written in. */
function EffectRows({
  rows,
  source,
}: {
  rows: Array<{ label: string; detail?: string; source?: string }>;
  source: string;
}) {
  return (
    <List density="balanced" hasDividers edge="flush" aria-label="Det här händer">
      {rows.map((r, i) => (
        <ListItem
          key={i}
          align="first-line"
          label={<Text weight="semibold">{r.label}</Text>}
          {...(r.detail ? { description: <Text type="supporting">{r.detail}</Text> } : {})}
          endContent={
            <Text type="supporting" textWrap="nowrap">
              {r.source ?? source}
            </Text>
          }
        />
      ))}
    </List>
  );
}

type FieldProps = {
  ask: Ask;
  value: string;
  onChange: (value: string) => void;
  problem: string | undefined;
  labels: Labels;
  isOpen: boolean;
  mobile: boolean;
  /** Where a meeting ask says which of its controls a problem is placed on. */
  keys: Map<string, () => string>;
};
const status = (problem: string | undefined) => (problem ? { type: 'error' as const, message: problem } : undefined);
/** One ask as its Astryx field, labelled with the ask's Swedish label; the required ones marked the form's way. */
function AskField(props: FieldProps) {
  const { ask, value, onChange, problem, mobile } = props;
  const size = mobile ? 'lg' : 'md';
  const field = (node: ReactNode) => <VStack data-ask={ask.property}>{node}</VStack>;
  switch (ask.kind) {
    case 'meeting':
      return <MeetingField {...props} ask={ask} />;
    case 'text':
      return field(
        <TextInput
          label={ask.label}
          isRequired={ask.required}
          value={value}
          onChange={onChange}
          size={size}
          width="100%"
          status={status(problem)}
        />,
      );
    case 'long-text':
      return field(
        <TextArea
          label={ask.label}
          isRequired={ask.required}
          value={value}
          onChange={v => onChange(v)}
          rows={3}
          width="100%"
          status={status(problem)}
        />,
      );
    case 'date':
      return field(
        <DateInput
          label={ask.label}
          isRequired={ask.required}
          value={(value || undefined) as never}
          onChange={v => onChange(v ?? '')}
          weekStartsOn="mon"
          presentation="adaptive-bottom-sheet"
          hasClear={!ask.required}
          size={size}
          status={status(problem)}
        />,
      );
    case 'choice':
      return field(
        ask.options.length <= 5 ? (
          <RadioList
            label={ask.label}
            isRequired={ask.required}
            value={value}
            onChange={onChange}
            status={status(problem)}
          >
            {ask.options.map(o => (
              <RadioListItem key={o.value} value={o.value} label={o.label} />
            ))}
          </RadioList>
        ) : (
          <Selector
            label={ask.label}
            isRequired={ask.required}
            options={ask.options}
            value={value}
            onChange={onChange}
            size={size}
            status={status(problem)}
          />
        ),
      );
  }
}

const OTHER = 'other';
/**
 * An ask of a meeting time (board ActBook): up to three free times from the person's own calendar, each saying its day,
 * its time and that the person is free, then "Annan tid" with a date and a clock; under them the person's own day for
 * the chosen date, drawn by the calendar family (`DayStrip`, on a phone the `EventList` that fits its width) and said in
 * words for a screen reader. Without a calendar only the date and the clock are drawn, and no day.
 */
function MeetingField({
  ask,
  value,
  onChange,
  problem,
  labels,
  isOpen,
  mobile,
  keys,
}: FieldProps & { ask: Extract<Ask, { kind: 'meeting' }> }) {
  const groupLabel = useId();
  const size = mobile ? 'lg' : 'md';
  const times = useQuery({
    ...meetingTimesQuery(labels.capability, ask.property, labels.before, null),
    enabled: isOpen,
  });
  const slots = times.data?.slots ?? [];
  // Whether the times have been asked: until then nothing is said about the value (the field is a skeleton).
  const known = times.isSuccess || times.isError;
  const onSlot = slots.some(s => s.start === value);
  const [other, setOther] = useState<{ date?: string; time?: string } | null>(null);
  // A value that is not one of the times offered is "Annan tid" (a value from an assistant's draft, or typed before).
  const choice = other || (value && known && !onSlot) ? OTHER : onSlot ? value : (slots[0]?.start ?? OTHER);
  useEffect(() => {
    // The first free time is chosen until the person chooses otherwise (the template: a sensible default).
    if (!value && !other && slots[0]) onChange(slots[0].start);
  }, [value, other, slots[0]?.start]);
  useEffect(() => {
    if (value && known && !onSlot && !other) setOther(meetingParts(value) ?? {});
  }, [value, known, onSlot]);
  const otherParts = other ?? (value && known && !onSlot ? (meetingParts(value) ?? {}) : {});
  const setOtherPart = (part: { date?: string; time?: string }) => {
    const next = { ...otherParts, ...part };
    setOther(next);
    onChange(meetingStart(next.date, next.time) ?? '');
  };
  const date = choice === OTHER ? otherParts.date : isInstant(value) ? displayDate(value) : undefined;
  const day = useQuery({
    ...meetingTimesQuery(labels.capability, ask.property, labels.before, date ?? null),
    enabled: isOpen && !!date,
  });
  const chosen =
    isInstant(value) && date && displayDate(value) === date
      ? { start: value, end: meetingEnd(value, ask.durationMinutes) }
      : undefined;
  const entries = day.data?.day ? agendaItems(day.data.day.events, day.data.day.proposals) : [];
  const clash = chosen && choice === OTHER ? clashes(entries, chosen) : [];
  // Where a problem is placed: on the date or the clock when "Annan tid" is chosen, else on the choice.
  const placed = choice === OTHER ? (otherParts.date ? 'time' : 'date') : 'choice';
  keys.set(ask.property, () => (placed === 'choice' ? ask.property : `${ask.property}:${placed}`));
  const otherFields = (
    <FormLayout direction={mobile ? 'vertical' : 'horizontal'} defaultOptionality="optional">
      <VStack data-ask={`${ask.property}:date`}>
        <DateInput
          label="Datum"
          isRequired
          value={otherParts.date as never}
          onChange={v => setOtherPart({ date: v ?? undefined })}
          weekStartsOn="mon"
          presentation="adaptive-bottom-sheet"
          size={size}
          status={placed === 'date' ? status(problem) : undefined}
        />
      </VStack>
      <VStack data-ask={`${ask.property}:time`}>
        <TimeInput
          label="Klockslag"
          isRequired
          value={otherParts.time as never}
          onChange={v => setOtherPart({ time: v ?? undefined })}
          increment={15}
          size={size}
          status={
            placed === 'time' && problem
              ? status(problem)
              : clash.length
                ? { type: 'warning', message: `Du har ${clash.join(', ')} då.` }
                : undefined
          }
        />
      </VStack>
    </FormLayout>
  );
  return (
    <VStack gap={3}>
      {times.isPending ? (
        <VStack gap={2} aria-busy="true">
          <Text weight="semibold">{ask.label}</Text>
          <Text type="supporting" role="status">
            Letar efter lediga tider i din kalender …
          </Text>
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="50%" />
        </VStack>
      ) : slots.length ? (
        <VStack gap={3}>
          <VStack data-ask={ask.property}>
            <RadioList
              label={ask.label}
              description={`${ask.durationMinutes} minuter`}
              isRequired={ask.required}
              value={choice}
              onChange={next => {
                if (next === OTHER) {
                  setOther(meetingParts(value) ?? {});
                  onChange(value);
                } else {
                  setOther(null);
                  onChange(next);
                }
              }}
              status={placed === 'choice' ? status(problem) : undefined}
            >
              {slots.map(s => {
                const words = slotText(s);
                return (
                  <RadioListItem key={s.start} value={s.start} label={words.label} description={words.description} />
                );
              })}
              <RadioListItem value={OTHER} label="Annan tid" />
            </RadioList>
          </VStack>
          {choice === OTHER && otherFields}
        </VStack>
      ) : (
        // No calendar to suggest from: the date and the clock under the ask's label, as one group (the template's Field).
        <Field
          label={ask.label}
          inputID={`${groupLabel}-date`}
          labelID={groupLabel}
          isGroupLabel
          isRequired={ask.required}
          description={`${ask.durationMinutes} minuter`}
        >
          <VStack role="group" aria-labelledby={groupLabel}>
            {otherFields}
          </VStack>
        </Field>
      )}
      {date && day.data?.day && (
        <VStack gap={2}>
          {mobile ? (
            <EventList
              from={date}
              days={1}
              items={agendaItems(
                day.data.day.events,
                day.data.day.proposals,
                [],
                chosen ? { ...chosen, title: 'Vald tid' } : undefined,
              )}
              label={`Din dag, ${dayLabel(date)}`}
              dayHeadingLevel={3}
              accessiblePath={dayWords(entries, chosen)}
            />
          ) : (
            <DayStrip
              date={date}
              items={agendaItems(
                day.data.day.events,
                day.data.day.proposals,
                [],
                chosen ? { ...chosen, title: 'Vald tid' } : undefined,
              )}
              label={`Din dag, ${dayLabel(date)}`}
              dayHeadingLevel={3}
              accessiblePath={dayWords(entries, chosen)}
            />
          )}
        </VStack>
      )}
    </VStack>
  );
}
