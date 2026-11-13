import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardingEvent, BoardingPersonOutput, BoardingPreview, BoardingStartBody } from '@clew/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogHeader,
  FieldStatus,
  FormLayout,
  HStack,
  Heading,
  LayoutHeader,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Selector,
  Skeleton,
  Step,
  Stepper,
  Text,
  VStack,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { ApiError, api } from '../api';
import {
  anchorWord,
  conditionWords,
  unitLabelOf,
  itemsWords,
  layerCounts,
  longDay,
  previewOwners,
  shortDay,
  startWords,
} from '../boarding';
import { useBoardingWrite } from '../mutations';
import { boardingPlanQuery, boardingPreviewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { mobileQuery } from '../media';
import { DialogFrame } from './dialog-frame';

/** What one step needs beside the other for its marker and its longest label, "Det här händer", to be drawn whole. */
const STEP_WIDTH = 160;
/** The buddy chosen as none: no person's id is empty. */
const NO_BUDDY = '';
type Step = 'fill-in' | 'effect';

/**
 * Starting an introduction or a leaving (D124 items 1, 7 and 8): the manager's dialog over the plan's page, composed as
 * the action dialog is (the `form-wizard-dialog` template, `action-dialog.tsx`): "Uppgifter" asks the day (an
 * introduction's first day prefilled from the employment's start date when the directory sent one, a leaving's last day
 * entered by the manager) and, optionally, a buddy among the manager's other reports; "Det här händer" reads
 * `POST /api/boarding/preview` for exactly those answers and says which layers apply and how many items each gives, who
 * gets how many, and that nothing is ordered or sent anywhere by starting. Nothing is written before the last button.
 * A refusal of the day or the buddy is placed on its field when "Nästa" asks for the preview; a refusal of the start is
 * said under the buttons. On a phone the dialog fills the screen with its buttons pinned at the foot.
 *
 * The dialog is named in the address (`?start=introduction|leaving`, `boarding-address.ts`), so the page opens it and
 * closes it; `onClosed` is told once the dialog has closed, and whether it started a plan, so the page can give the focus
 * to its heading (a plan started) or back to what opened it when Astryx has nothing to return it to (the address opened
 * it). On success the module's reads and the new plan are read again before the dialog closes, so the page shows the plan
 * when the focus arrives, and a toast says the plan is started.
 */
export function StartPlanDialog({
  event,
  person,
  readerId,
  onClose,
  onStarted,
  onClosed,
}: {
  /** The event the address opens the dialog for; null while it is closed. */
  event: BoardingEvent | null;
  /** The person's plans as the page read them: their name, the buddies to choose from and a suggested first day. */
  person: BoardingPersonOutput | undefined;
  /** The signed-in manager, who owns the items no one else is chosen for. */
  readerId: string;
  /** ✕, Esc, Avbryt: nothing is sent. */
  onClose: () => void;
  /** The plan is started and read: the page shows it. */
  onStarted: (planId: string) => void;
  /** The dialog has closed; `started` when it closed because a plan was started. */
  onClosed: (started: boolean) => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const announce = useAnnounce();
  const client = useQueryClient();
  const isOpen = !!event && !!person?.canStart;
  // The event shown, kept while the dialog closes so its words do not change mid-exit.
  const [shown, setShown] = useState<BoardingEvent>(event ?? 'introduction');
  if (event && event !== shown) setShown(event);
  const words = startWords[shown];
  const [step, setStep] = useState<Step>('fill-in');
  const [anchorOn, setAnchorOn] = useState<string | undefined>(undefined);
  const [buddyId, setBuddyId] = useState<string>(NO_BUDDY);
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<{ field: 'day' | 'buddy' | null; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const write = useBoardingWrite({ fallback: 'Planen kunde inte startas.', toastId: 'boarding:start' });
  const started = useRef(false);
  // Filled afresh each time it opens: the suggested first day for an introduction, nothing for a leaving.
  const [session, setSession] = useState<string | null>(null);
  const opening = isOpen ? `${person?.person.id}:${event}` : null;
  if (opening !== session) {
    setSession(opening);
    if (opening) {
      setStep('fill-in');
      setAnchorOn(event === 'introduction' ? person?.suggestedFirstDay : undefined);
      setBuddyId(NO_BUDDY);
      setTried(false);
      setRefusal(null);
      started.current = false;
      write.reset();
    }
  }
  const body: BoardingStartBody | null =
    person && anchorOn ? { personId: person.person.id, event: shown, anchorOn, ...(buddyId ? { buddyId } : {}) } : null;
  const preview = useQuery({
    ...boardingPreviewQuery(body ?? { personId: '', event: shown, anchorOn: '' }),
    enabled: isOpen && step === 'effect' && !!body,
  });

  const dayField = useRef<HTMLInputElement>(null);
  const buddyField = useRef<HTMLButtonElement>(null);
  const effectHeading = useRef<HTMLHeadingElement>(null);
  const effectId = useId();
  const [focusTo, setFocusTo] = useState<'day' | 'buddy' | 'effect' | null>(null);
  useEffect(() => {
    if (!focusTo) return;
    const frame = requestAnimationFrame(() => {
      (focusTo === 'day' ? dayField : focusTo === 'buddy' ? buddyField : effectHeading).current?.focus();
      setFocusTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTo, step]);

  const dayProblem = !anchorOn ? `Välj ${anchorWord[shown].toLowerCase()}.` : null;
  const shownProblem = (field: 'day' | 'buddy') =>
    refusal?.field === field ? refusal.message : field === 'day' && tried ? dayProblem : null;
  const status = (problem: string | null) => (problem ? { status: { type: 'error' as const, message: problem } } : {});

  /** "Nästa": the fields are checked, then the preview is read; a refusal of the day or the buddy goes on its field. */
  const toEffect = async () => {
    setTried(true);
    if (!body) {
      if (tried) announce(dayProblem ?? '', 'assertive');
      setFocusTo('day');
      return;
    }
    setChecking(true);
    try {
      await client.fetchQuery({ ...boardingPreviewQuery(body), staleTime: 0 });
      setRefusal(null);
      setStep('effect');
      setFocusTo('effect');
    } catch (error) {
      const message = errorMessage(error, 'Det gick inte att läsa vad som händer.');
      // The server's sentence names what it refuses: the buddy, or the day; anything else stands over the fields.
      const field =
        error instanceof ApiError && error.status === 400
          ? /fadder/i.test(message)
            ? 'buddy'
            : /dag|datum/i.test(message)
              ? 'day'
              : null
          : null;
      setRefusal({ field, message });
      if (field) setFocusTo(field);
      else announce(message, 'assertive');
    } finally {
      setChecking(false);
    }
  };
  const start = async () => {
    if (!body || write.busy) return;
    let id = '';
    const ok = await write.run(
      async () => {
        id = (await api.boarding.start(body)).id;
        // The new plan is read before the dialog lets go, so the page draws it when the focus moves to its heading.
        await client.fetchQuery(boardingPlanQuery(id));
      },
      words.started(person?.person.name ?? ''),
    );
    if (ok) {
      started.current = true;
      onStarted(id);
    }
  };
  const failure = write.error;
  const said = useRef<string | null>(null);
  useEffect(() => {
    // The refusal stands under the buttons, which not every screen reader reads as it appears (4.1.3): said as well.
    if (failure && failure !== said.current) announce(failure, 'assertive');
    said.current = failure;
  }, [failure, announce]);

  // Told once the dialog has closed, after Astryx has given the focus back to what opened it.
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const frame = useCallback((el: HTMLDivElement | null) => setDialog(el?.closest('dialog') ?? null), []);
  useEffect(() => {
    if (!dialog) return;
    const closed = () => closedRef.current(started.current);
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);

  const size = mobile ? 'lg' : 'md';
  const cancel = <Button size={size} variant="secondary" label="Avbryt" onClick={onClose} />;
  const footer =
    step === 'fill-in'
      ? {
          secondary: <Text type="supporting">Inget skickas i det här steget.</Text>,
          primary: (
            <>
              {tried && !body && (
                <FieldStatus type="error" variant="detached" message="En uppgift ovan behöver rättas först." />
              )}
              {cancel}
              <Button
                size={size}
                variant="primary"
                label="Nästa"
                isLoading={checking}
                onClick={() => void toEffect()}
              />
            </>
          ),
        }
      : {
          secondary: (
            <Button
              size={size}
              variant="secondary"
              label="Ändra"
              onClick={() => {
                setStep('fill-in');
                setFocusTo('day');
              }}
            />
          ),
          primary: (
            <>
              {cancel}
              <Button
                size={size}
                variant="primary"
                label={words.button}
                isDisabled={!preview.isSuccess}
                isLoading={write.busy}
                onClick={() => void start()}
              />
            </>
          ),
        };
  const name = person?.person.name ?? '';
  const header = (
    <>
      <DialogHeader
        title={words.title}
        subtitle={name ? `För ${name}` : undefined}
        onOpenChange={open => {
          if (!open) onClose();
        }}
        hasDivider={false}
      />
      <LayoutHeader hasDivider={false}>
        {/* A position indicator, not a way to move: the footer's buttons are the whole navigation (the template). */}
        <Stepper
          activeStep={step === 'fill-in' ? 0 : 1}
          orientation="horizontal"
          density="compact"
          label="Steg"
          horizontalOptions={{ minimumStepWidth: STEP_WIDTH, collapsedVariant: 'withLabel' }}
        >
          <Step step={0} label="Uppgifter" status={tried && (!body || refusal?.field) ? 'error' : undefined} />
          <Step step={1} label="Det här händer" />
        </Stepper>
      </LayoutHeader>
    </>
  );
  const buddies = person?.buddies ?? [];
  const buddyName = buddies.find(b => b.id === buddyId)?.name;
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      width={620}
      variant={mobile ? 'fullscreen' : 'standard'}
      purpose="form"
    >
      <DialogFrame header={header} error={failure} secondary={footer.secondary} primary={footer.primary}>
        <VStack ref={frame} gap={5}>
          {refusal && !refusal.field && (
            <Text as="p" role="alert" color="accent">
              {refusal.message}
            </Text>
          )}
          {step === 'fill-in' ? (
            <FormLayout direction="vertical" defaultOptionality="required">
              <DateInput
                ref={dayField}
                label={anchorWord[shown]}
                description={
                  shown === 'introduction'
                    ? person?.suggestedFirstDay
                      ? 'Förslaget är anställningens startdatum i katalogen. Ändra det om det inte stämmer.'
                      : 'Den första arbetsdagen. Punkterna räknas från den.'
                    : 'Den sista arbetsdagen. Punkterna räknas från den.'
                }
                value={anchorOn as never}
                onChange={value => {
                  setAnchorOn(value ?? undefined);
                  if (refusal?.field === 'day') setRefusal(null);
                }}
                weekStartsOn="mon"
                placeholder="Välj ett datum"
                presentation="adaptive-bottom-sheet"
                size={size}
                {...status(shownProblem('day'))}
              />
              {buddies.length > 0 ? (
                <Selector
                  ref={buddyField}
                  label="Fadder"
                  description="En av dina andra medarbetare. Utan fadder får du fadderns punkter."
                  placeholder="Ingen fadder"
                  options={[
                    { value: NO_BUDDY, label: 'Ingen fadder' },
                    ...buddies.map(b => ({ value: b.id, label: b.name })),
                  ]}
                  value={buddyId}
                  onChange={value => {
                    setBuddyId(value ?? NO_BUDDY);
                    if (refusal?.field === 'buddy') setRefusal(null);
                  }}
                  hasSearch={buddies.length > 8}
                  searchPlaceholder="Sök medarbetare"
                  emptySearchText="Ingen medarbetare matchar."
                  presentation="adaptive"
                  size={size}
                  isOptional
                  {...status(shownProblem('buddy'))}
                />
              ) : (
                <Text as="p" type="supporting">
                  Du har ingen annan medarbetare att välja som fadder, så fadderns punkter blir dina.
                </Text>
              )}
            </FormLayout>
          ) : (
            <VStack gap={5}>
              <MetadataList columns="single">
                <MetadataListItem label={anchorWord[shown]}>
                  <Text>{anchorOn ? longDay(anchorOn) : ''}</Text>
                </MetadataListItem>
                <MetadataListItem label="Fadder">
                  <Text>{buddyName ?? 'Ingen, du får fadderns punkter'}</Text>
                </MetadataListItem>
              </MetadataList>
              <VStack as="section" gap={3} aria-labelledby={effectId}>
                <Heading ref={effectHeading} tabIndex={-1} level={3} id={effectId}>
                  {`När du trycker ${words.button}`}
                </Heading>
                {preview.isPending ? (
                  <VStack gap={2} aria-busy="true">
                    <Text type="supporting" role="status">
                      Läser vad planen får …
                    </Text>
                    <Skeleton height={20} width="70%" />
                    <Skeleton height={20} width="50%" />
                  </VStack>
                ) : preview.isError ? (
                  <VStack gap={2}>
                    <Text as="p">{errorMessage(preview.error, 'Det gick inte att läsa vad som händer.')}</Text>
                    <HStack>
                      <Button
                        size={size}
                        variant="secondary"
                        label="Försök igen"
                        isLoading={preview.isFetching}
                        onClick={() => void preview.refetch()}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <Effect preview={preview.data} readerId={readerId} name={name} />
                )}
              </VStack>
            </VStack>
          )}
        </VStack>
      </DialogFrame>
    </Dialog>
  );
}

/**
 * "Det här händer" (board StartPlan): how many items from which layers, who gets how many and when the first is due,
 * and that starting orders and sends nothing. Each layer says whom it applies to; a plan no layer applies to starts empty.
 */
function Effect({ preview, readerId, name }: { preview: BoardingPreview; readerId: string; name: string }) {
  const layersId = useId();
  const ownersId = useId();
  const counted = layerCounts(preview);
  const owners = previewOwners(preview, readerId);
  const layers = preview.layers.length;
  return (
    <VStack gap={5}>
      {preview.items.length === 0 ? (
        <Text as="p">{`Inget lager gäller för ${name} ännu, så planen startar utan punkter. Du kan lägga till punkter själv.`}</Text>
      ) : (
        <>
          <VStack as="section" gap={2} aria-labelledby={layersId}>
            <Heading level={4} id={layersId}>
              {`Planen får ${itemsWords(preview.items.length)} från ${layers === 1 ? 'ett lager' : `${layers} lager`}`}
            </Heading>
            <List density="balanced" hasDividers edge="flush" aria-labelledby={layersId}>
              {preview.layers.map(l => (
                <ListItem
                  key={l.id}
                  label={<Text weight="semibold">{l.name}</Text>}
                  description={<Text type="supporting">{conditionWords(l.condition, l.value, unitLabelOf(l))}</Text>}
                  endContent={
                    <Text type="supporting" textWrap="nowrap">
                      {itemsWords(counted.get(l.id) ?? 0)}
                    </Text>
                  }
                />
              ))}
            </List>
          </VStack>
          <VStack as="section" gap={2} aria-labelledby={ownersId}>
            <Heading level={4} id={ownersId}>
              Vem som får vad
            </Heading>
            <List density="balanced" hasDividers edge="flush" aria-labelledby={ownersId}>
              {owners.map(o => (
                <ListItem
                  key={o.id}
                  label={<Text weight="semibold">{o.you ? 'Du' : o.name}</Text>}
                  description={
                    <Text type="supporting">{`${itemsWords(o.count)} i Att göra, den första senast ${shortDay(o.first)}`}</Text>
                  }
                />
              ))}
            </List>
          </VStack>
        </>
      )}
      <Text as="p">
        Inget beställs, bokas eller skickas till något annat system när du startar. Varje punkt blir en uppgift i Att
        göra hos den som ska göra den.
      </Text>
    </VStack>
  );
}
