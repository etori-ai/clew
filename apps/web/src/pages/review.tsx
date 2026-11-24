import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Receipt, ReviewEvidence, Thread, ThreadAction } from '@clew/contracts';
import {
  AspectRatio,
  Badge,
  Button,
  Card,
  CompletionFeedback,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  LayoutFooter,
  Lightbox,
  List,
  ListItem,
  ProgressBar,
  Skeleton,
  Step,
  Stepper,
  Text,
  VisuallyHidden,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../api';
import { previewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { expectReceipt } from '../linger';
import { today } from '@clew/calendar/dates';
import { atStep, namesStep, retriedReviewHref, stepOf, withStep } from '../review-address';
import {
  approvedOf,
  begun,
  clearDraft,
  leftOf,
  nextStep,
  reviewRows,
  sameVersions,
  seenOf,
  useReviewDraft,
  useReviewShownForTheWayBack,
  withDecision,
  withoutDecision,
  type Decision,
} from '../review-session';
import { mobileQuery } from '../components/shell/shell';
import { ActionRow, useCardAction } from '../components/work/card';
import { ItemAbout, Notes, dueBadge, sourceLine, useWorkItem } from '../components/work/work-item';
import { PageFrame, WayBack, narrowPageQuery } from '../components/shell/page-frame';
import { FactsInColumn } from '../components/shell/page-frame-context';
import { itemPageSubject } from '../components/conversation/page-conversation';
import { DocumentReader } from '../components/views/document-reader';
import { ReviewRecovery } from '../components/work/review-recovery';

/** The page's heading when the review cannot be read, in the browser's tab too. */
const FAILED_TITLE = 'Granskningen kunde inte läsas';
const decisionWord: Record<Decision, string> = { approve: 'Vald för godkännande', leave: 'Lämnas kvar' };
/** The verb of the action, for its buttons: "Attestera valda" is "Attestera" on one row. */
const verbOf = (action: ThreadAction) => action.label.replace(/\s+valda$/i, '');
/** An item that has been sent: its review is read, not decided. */
const submitted = (thread: Thread) =>
  !!thread.receipt ||
  thread.state !== 'open' ||
  (!!thread.execution && !(thread.execution.compensates && thread.execution.state === 'succeeded'));
/** Evidence read this long before it expires is read again before it is sent (D79: two hours). */
const EVIDENCE_MARGIN_MS = 60_000;

/**
 * An image of the evidence at the column's width (a scanned invoice from before documents had pages): Astryx's
 * `AspectRatio` at the image's own proportions, read once it has loaded, with the image contained in it, so it is drawn
 * whole and never cropped or stretched. Its place is held by a skeleton until then.
 */
function FullWidthImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setRatio(null);
    const image = new Image();
    image.onload = () =>
      setRatio(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 4 / 3);
    image.onerror = () => setRatio(4 / 3);
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  if (ratio === null) return <Skeleton height={480} />;
  return (
    <AspectRatio ratio={ratio} fit="contain">
      <img src={src} alt={alt} />
    </AspectRatio>
  );
}

/**
 * The page of a work item reviewed one row at a time (D70 item 2), which is its review (D142, canvas "Clew · card or
 * straight to the work", the row drawn from the real components): one page and one address, `/items/<threadId>`, before
 * the decision is sent and after it. The item's own title, due badge and ⋯ are in the header, with its status notice
 * under the title once something has happened (`ActionRow`); the rows are the steps under that (a `Stepper` below five
 * rows, with Skicka last until it is sent; a `ProgressBar` from five, with the rows as a list in the end panel); the
 * row's decision and its document are in the column; the item's facts, "Varför ser jag detta?" and "Händelser" are in
 * the end panel (after the row where the window is narrow); and the decision's buttons, then Skicka, are in the pinned
 * footer until it is sent. On a phone nothing is pinned above the step; on a short screen nothing is pinned at all.
 *
 * An address that names no step opens where the next press is: the first row not yet judged, or once it is sent the
 * first row the source refused or left unanswered. The decisions are the person's draft for the session
 * (`review-session.ts`); the evidence of each document read (D79) is this page's alone. Nothing is written until the
 * last step's one button, which runs the item's own execute with the approved refs (`useCardAction`, D45/D47); the page
 * then stays where it is and shows what the source answered. No text input (D12).
 */
export function ReviewedItem({
  live,
  action,
  from,
  back,
  onChange,
}: {
  /** The item as the cache has it now, which says when the source's answer has come to rest. */
  live: Thread;
  action: ThreadAction;
  /** The page the item was opened from, for the way back of the item that takes its place (D80). */
  from: string | null;
  back: { label: string; href: string };
  /** The item was sent away by its own menu (Avfärda, Inte nu): the page leads back. */
  onChange: (thread: Thread) => void;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const mobile = useMediaQuery(mobileQuery);
  // While the decision is on its way the item turns handled in the cache: the review keeps the item it was sending from
  // until it has led back to the item.
  const [sending, setSending] = useState(false);
  const kept = useRef<Thread>(live);
  if (!sending) kept.current = live;
  const thread = sending ? kept.current : live;
  const readOnly = submitted(thread);
  const items = reviewRows(thread);
  const [draft, setDraft] = useReviewDraft(readOnly ? undefined : thread);
  // The step the address names; with none, where the next press is. Once sent there is no last step, and a step the
  // address still names from before (Skicka) is the opening one.
  const query = new URLSearchParams(search);
  const needsPerson = items.findIndex(i =>
    ['failed', 'unknown'].includes(thread.receipt?.rows.find(r => r.ref === i.ref)?.outcome ?? ''),
  );
  const opening = readOnly ? Math.max(0, needsPerson) : begun(draft) ? nextStep(draft, items) : 0;
  const named = namesStep(query) ? stepOf(query, readOnly ? items.length : items.length + 1) : opening;
  const where = named ?? (readOnly ? opening : null);
  const step = where ?? 0;
  const item = items[step];
  const last = step >= items.length;
  // The item's own parts (`work-item.tsx`): its marks, its facts, and its actions for the notice and ⋯.
  const about = useWorkItem(live, onChange);
  const decisions = draft.decisions;
  // The evidence of each approval, from the read the person decided on (D79): in memory only, never kept.
  const [evidence, setEvidence] = useState<Record<string, ReviewEvidence>>({});
  const approved = approvedOf(draft, items);
  const left = leftOf(draft, items).length;
  const undecided = items.filter(i => !decisions[i.ref]).length;
  const verb = verbOf(action);
  const source = thread.trigger.source;
  // The address this review was opened at, for the control on the item that leads back to it (2.4.3).
  const [opened] = useState(() => pathname + search);
  useReviewShownForTheWayBack(thread.id, opened);
  const [zoom, setZoom] = useState(false);
  // A step is a place in the address, rewritten in place, so the browser's Back leaves the review (D73 item 1).
  const goTo = (n: number) => navigate(atStep(pathname, search, n), { replace: true });
  const preview = useQuery({ ...previewQuery(thread.id, item?.ref ?? '', item?.revision), enabled: !!item });
  const documents = preview.data && 'kind' in preview.data ? preview.data : undefined;
  const legacy = preview.data && 'mediaType' in preview.data ? preview.data : undefined;
  const dataUrl = legacy ? `data:${legacy.mediaType};base64,${legacy.data}` : null;
  const isImage = !!legacy && legacy.mediaType !== 'application/pdf';
  const decide = (d: Decision) => {
    if (!item || readOnly) return;
    const proof = d === 'approve' ? documents?.evidence : undefined;
    setDraft(withDecision(draft, item.ref, d, proof ? seenOf(proof) : undefined));
    setEvidence(prev => {
      const { [item.ref]: _was, ...next } = prev;
      return proof ? { ...next, [item.ref]: proof } : next;
    });
    goTo(step + 1);
  };
  const invalidate = (refs: string[]) => {
    setDraft(refs.reduce(withoutDecision, draft));
    setEvidence(prev => Object.fromEntries(Object.entries(prev).filter(([ref]) => !refs.includes(ref))));
  };
  // Skicka is the item's own execute (D45/D47): the button keeps loading until the source's answer has come to rest,
  // and only then does the page lead back to the item, where the row keeps its place with the receipt (D70 item 1).
  // The mutation response can arrive before the list query notifies this render. Keep that confirmed answer too.
  const response = useRef<Thread | null>(null);
  const { settling, error, perform, run, confirmation } = useCardAction({
    thread: live,
    onChange: t => {
      response.current = t;
    },
  });
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [completed, setCompleted] = useState<Receipt | null>(null);
  // Sent: the page stays, now the item after its decision, opened where the source's answer needs the person. Hem's
  // first reading counts the receipt as arriving (`expectReceipt`), so the row there keeps its moment (D70 item 1).
  const onSent = () => {
    expectReceipt(thread.id);
    setCompleted(null);
    setSending(false);
    navigate(withStep(pathname, search, 0), { replace: true });
  };
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  /**
   * The evidence for every approval (D79): the read the person decided on while this page has it; after a reload or a
   * way out and back, a fresh read of the row's documents, sent only when its versions are the ones the approval was
   * taken on. A row whose documents have changed loses its approval and says so; nothing is sent then.
   */
  const evidenceForApproved = async (): Promise<ReviewEvidence[] | null> => {
    const now = Date.now();
    const reads = await Promise.all(
      approved.map(async ref => {
        const held = evidence[ref];
        if (held && Date.parse(held.expiresAt) > now + EVIDENCE_MARGIN_MS) return { ref, proof: held };
        const seen = draft.seen[ref];
        if (!seen) return { ref, proof: held };
        const fresh = await api.preview(thread.id, ref);
        return 'kind' in fresh && sameVersions(seen, fresh.evidence)
          ? { ref, proof: fresh.evidence }
          : { ref, proof: undefined, changed: true };
      }),
    ).catch((e: unknown) => {
      setSendError(errorMessage(e, 'Underlaget kunde inte läsas igen. Försök igen.'));
      return null;
    });
    if (!reads) return null;
    const changed = reads.filter(r => 'changed' in r).map(r => items.find(i => i.ref === r.ref)!);
    if (changed.length) {
      invalidate(changed.map(i => i.ref));
      setSendError(
        changed.length === 1
          ? `Underlaget för ${changed[0]!.label} har ändrats sedan du godkände raden. Granska den igen innan du skickar.`
          : `Underlaget för ${changed.length} rader har ändrats sedan du godkände dem: ${changed.map(i => i.label).join(', ')}. Granska dem igen innan du skickar.`,
      );
      return null;
    }
    return reads.flatMap(r => (r.proof ? [r.proof] : []));
  };
  const send = async () => {
    if (readOnly || sending) return;
    setSendError(null);
    response.current = null;
    setSending(true);
    const reviews = await evidenceForApproved();
    if (!reviews) {
      setSending(false);
      return;
    }
    const ran = await perform(action, approved, reviews);
    if (ran) setSent(true);
    else setSending(false);
  };
  useEffect(() => {
    if (!sent || settling) return;
    setSent(false);
    if (error) {
      setSending(false);
      return;
    }
    // Sent: the draft has done its work.
    clearDraft(thread.id);
    const receipt = live.receipt ?? response.current?.receipt;
    if (
      receipt &&
      approved.length > 0 &&
      approved.every(ref => receipt.rows.some(row => row.ref === ref && row.outcome === 'done'))
    )
      setCompleted(receipt);
    else onSent();
  }, [sent, settling, error, live.receipt]);
  useEffect(() => {
    if (!completed) return;
    const timer = setTimeout(() => onSentRef.current(), 1800);
    return () => clearTimeout(timer);
  }, [completed]);
  // Each step opens on its one next step, so Enter takes it (artboard B); the last step on its button, or its heading
  // when there is nothing to send. A frame later, so the page has been drawn first. On a phone a step opens on its
  // document instead (D73, second amendment): the document is the one thing a review is for, and Enter is not the way
  // on a touch screen; the verb is a thumb's reach under it, pinned to the foot.
  const primary = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const paperHeading = useRef<HTMLHeadingElement>(null);
  // Once it is sent the page is read, not decided: it opens on the item's title, which the notice stands under (2.4.3,
  // as every item's page does), also when the source's answer arrives here; moving between its rows opens each on its
  // document.
  const shown = useRef<{ step: number; readOnly: boolean } | null>(null);
  useEffect(() => {
    const moved = !!shown.current && shown.current.readOnly === readOnly && shown.current.step !== step;
    shown.current = { step, readOnly };
    const frame = requestAnimationFrame(() =>
      (
        (readOnly && !moved
          ? about.title.current
          : mobile || readOnly
            ? paperHeading.current
            : // From Astryx 0.7.12 a disabled Button says so with aria-disabled and keeps its place in the tab order.
              primary.current?.disabled || primary.current?.getAttribute('aria-disabled') === 'true'
              ? paperHeading.current
              : primary.current) ?? heading.current
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [step, mobile, readOnly]);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const readyKey = (id: string, revision: string) =>
    `${documents?.bundle.ref}:${documents?.bundle.revision}:${id}:${revision}`;
  const canApprove =
    !preview.isFetching &&
    !preview.isError &&
    !!preview.data &&
    (!documents || documents.bundle.documents.filter(d => d.required).every(d => ready[readyKey(d.id, d.revision)]));
  // Legacy image reviews keep their one-press keyboard path once loading finishes. Never take focus from a control
  // the person has already reached, or jump away from the versioned document's reading controls.
  useEffect(() => {
    if (!mobile && legacy && canApprove && document.activeElement === paperHeading.current) primary.current?.focus();
  }, [mobile, legacy, canApprove]);
  // A decided row carries its mark; a row not yet looked at has none, and its description says so.
  const rowOutcome = (ref: string) => thread.receipt?.rows.find(r => r.ref === ref);
  const rowStatus = (ref: string) =>
    readOnly
      ? !thread.receipt
        ? 'Väntar på besked'
        : { done: 'Bekräftad', failed: 'Avvisad', unknown: 'Obekräftad', skipped: 'Inte skickad' }[
            rowOutcome(ref)?.outcome ?? 'skipped'
          ]
      : decisions[ref]
        ? decisionWord[decisions[ref]!]
        : undefined;
  const rowTone = (ref: string) =>
    readOnly
      ? !thread.receipt
        ? 'warning'
        : ({ done: 'success', failed: 'error', unknown: 'warning', skipped: 'neutral' } as const)[
            rowOutcome(ref)?.outcome ?? 'skipped'
          ]
      : decisions[ref] === 'leave'
        ? 'warning'
        : 'info';
  const decisionIcon = (ref: string) =>
    readOnly ? (
      <Icon
        icon={rowOutcome(ref)?.outcome === 'done' ? 'check' : rowOutcome(ref)?.outcome === 'failed' ? 'error' : 'clock'}
        color={
          ({ success: 'success', error: 'error', warning: 'warning', neutral: 'secondary', info: 'info' } as const)[
            rowTone(ref)
          ]
        }
        label={rowStatus(ref)}
      />
    ) : decisions[ref] === 'approve' ? (
      <Icon icon="check" color="info" label={decisionWord.approve} />
    ) : decisions[ref] === 'leave' ? (
      <Icon icon="clock" color="warning" label={decisionWord.leave} />
    ) : undefined;
  // "Hittills": every row with what was decided on it and the way to it, beside the step in the rail, which is its
  // landmark, and under it where the window is narrow or the assistant's pane has the end slot, as a section of the
  // column (`inColumn`).
  const soFar = (inColumn: boolean) => (
    <VStack gap={3} {...(inColumn ? { as: 'section' as const, 'aria-labelledby': 'review-so-far' } : {})}>
      <Heading id="review-so-far" level={3} accessibilityLevel={2}>
        Rader
      </Heading>
      <List density="compact" hasDividers aria-label="Rader">
        {items.map((i, n) => (
          <ListItem
            key={i.ref}
            startContent={decisionIcon(i.ref)}
            label={
              <Text weight={n === step ? 'semibold' : undefined}>
                {n + 1}. {i.label}
              </Text>
            }
            description={rowStatus(i.ref) ?? (n === step ? 'Det här' : 'Inte bedömd än')}
            endContent={
              n !== step ? (
                <Button
                  size="sm"
                  variant="ghost"
                  label={readOnly ? 'Visa' : decisions[i.ref] ? 'Ändra' : 'Granska'}
                  aria-label={`${readOnly ? 'Visa' : decisions[i.ref] ? 'Ändra' : 'Granska'} rad ${n + 1}: ${i.label}`}
                  isDisabled={sending}
                  onClick={() => goTo(n)}
                />
              ) : undefined
            }
          />
        ))}
      </List>
    </VStack>
  );
  const paper = item && (
    <VStack gap={2} as="section" aria-label="Underlaget">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Heading ref={paperHeading} tabIndex={-1} level={4} accessibilityLevel={3}>
          Underlag från {source}
        </Heading>
        {dataUrl && isImage && <Button size="sm" variant="ghost" label="Förstora" onClick={() => setZoom(true)} />}
      </HStack>
      <Card padding={3}>
        {preview.isPending || preview.isFetching ? (
          <Skeleton height={480} />
        ) : preview.isError ? (
          <VStack gap={2}>
            <Text as="p" role="alert">
              {errorMessage(preview.error, 'Underlaget kunde inte hämtas.')}
            </Text>
            <HStack>
              <Button size="sm" variant="secondary" label="Försök igen" onClick={() => void preview.refetch()} />
            </HStack>
          </VStack>
        ) : documents ? (
          <DocumentReader
            key={documents.bundle.ref + ':' + documents.bundle.revision}
            bundle={documents.bundle}
            capability={documents.capability}
            input={{ ref: documents.bundle.ref }}
            onReady={(id, revision, loaded) => setReady(prev => ({ ...prev, [readyKey(id, revision)]: loaded }))}
          />
        ) : dataUrl && isImage ? (
          <FullWidthImage src={dataUrl} alt={legacy!.title} />
        ) : dataUrl ? (
          <VStack gap={2}>
            <Text>{legacy!.title}</Text>
            <HStack>
              <Button size="sm" variant="secondary" label="Hämta underlaget (PDF)" href={dataUrl} />
            </HStack>
          </VStack>
        ) : null}
      </Card>
      {dataUrl && isImage && (
        <Lightbox isOpen={zoom} onOpenChange={setZoom} media={{ src: dataUrl, alt: legacy!.title }} hasZoom />
      )}
    </VStack>
  );
  // The page's title is the h1; a row and the summary are the level under it, the document the level under the row.
  const decision = item && (
    <VStack gap={1}>
      {rowStatus(item.ref) && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge
            variant={rowTone(item.ref)}
            icon={
              <Icon
                icon={
                  readOnly
                    ? rowOutcome(item.ref)?.outcome === 'done'
                      ? 'check'
                      : rowOutcome(item.ref)?.outcome === 'failed'
                        ? 'error'
                        : 'clock'
                    : decisions[item.ref] === 'approve'
                      ? 'check'
                      : 'clock'
                }
              />
            }
            label={rowStatus(item.ref)!}
          />
        </HStack>
      )}
      <Heading ref={heading} tabIndex={-1} level={2}>
        {item.label}
      </Heading>
      <Text as="p" color="secondary">
        {item.detail}
      </Text>
      {readOnly && rowOutcome(item.ref)?.detail && <Text as="p">{rowOutcome(item.ref)!.detail}</Text>}
      {documents?.recovery && (
        <ReviewRecovery
          key={documents.bundle.ref + ':' + documents.bundle.revision}
          document={documents}
          editable={
            (readOnly &&
              rowOutcome(item.ref)?.outcome === 'failed' &&
              ['failed', 'partial'].includes(thread.execution?.state ?? '')) ||
            (!readOnly && thread.topic.startsWith('retry:'))
          }
          onSaved={async () => {
            invalidate([item.ref]);
            await preview.refetch();
            paperHeading.current?.focus();
          }}
        />
      )}
    </VStack>
  );
  const summary = last && (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading ref={heading} tabIndex={-1} level={2}>
          {readOnly ? 'Beslutets resultat' : 'Det du valt'}
        </Heading>
        <Text as="p" color="secondary">
          {readOnly ? (
            (thread.receipt?.headline ?? 'Väntar på källans besked.')
          ) : (
            <>
              {approved.length} av {items.length} skickas{left ? `, ${left} lämnas kvar` : ''}
              {undecided ? `, ${undecided} ${undecided === 1 ? 'är inte bedömd' : 'är inte bedömda'}` : ''}. Inget är
              skrivet än.
            </>
          )}
        </Text>
      </VStack>
      {!readOnly && (
        <Card padding={3} variant="muted">
          <VStack gap={1.5}>
            <Text weight="semibold">Vad som händer när du skickar</Text>
            <Text as="p" type="supporting">
              {verb} skrivs till {source} i ett beslut och läses tillbaka rad för rad som kvitto. Grönt bara när{' '}
              {source} har bekräftat. Ärendet går till Klart
              {left + undecided > 0
                ? `; det som lämnas kvar ligger kvar i ärendet och kommer som ett eget ärende vid nästa genomgång.`
                : '.'}
            </Text>
          </VStack>
        </Card>
      )}
      {(sendError ?? error) && !sending && (
        <Text as="p" role="alert" color="accent">
          {sendError ?? error}
        </Text>
      )}
      {confirmation}
    </VStack>
  );
  const trailLine = (
    <Text type="supporting" color="secondary">
      {sourceLine(about.mark, about.own)}
    </Text>
  );
  const judged = readOnly
    ? (thread.receipt?.rows.filter(r => r.outcome === 'done').length ?? 0)
    : items.length - undecided;
  // The rows once: as steps below five, where the steps are the way between them; from five as a bar with the way
  // between them under it, and as a list in the end panel (`soFar`).
  const steps = items.map((i, n) => (
    <Step
      key={i.ref}
      step={n}
      label={i.label}
      indicator={decisionIcon(i.ref) ?? 'number'}
      status={
        readOnly
          ? rowTone(i.ref) === 'neutral' || rowTone(i.ref) === 'info'
            ? undefined
            : (rowTone(i.ref) as 'success' | 'warning' | 'error')
          : decisions[i.ref] === 'leave'
            ? 'warning'
            : undefined
      }
      isDisabled={sending}
      aria-label={i.label}
    >
      {rowStatus(i.ref) && (
        <Text as="p" type="supporting">
          {rowStatus(i.ref)}
        </Text>
      )}
    </Step>
  ));
  if (!readOnly)
    steps.push(<Step key="send" step={items.length} label="Skicka" indicator="number" isDisabled={sending} />);
  // The way between the rows by one at a time: from five rows, and on a phone, where the steps are a bare track with
  // no room for their names (2.1.1: every row is reached there too, to change a decision or to read an answer).
  const between = (
    <HStack gap={2} vAlign="center" as="nav" aria-label="Granskningens rader">
      <IconButton
        size="sm"
        variant="ghost"
        label="Föregående"
        tooltip="Föregående rad"
        icon={<Icon icon="chevronLeft" />}
        isDisabled={step === 0 || sending}
        onClick={() => goTo(step - 1)}
      />
      <Text role="status">{item ? `${step + 1} av ${items.length}` : 'Översikt'}</Text>
      <IconButton
        size="sm"
        variant="ghost"
        label="Nästa"
        tooltip="Nästa rad"
        icon={<Icon icon="chevronRight" />}
        isDisabled={last || sending || (readOnly && step === items.length - 1)}
        onClick={() => goTo(step + 1)}
      />
    </HStack>
  );
  const progress =
    items.length > 1 && items.length < 5 ? (
      <>
        {/* Where the person stands is said when the step changes (4.1.3); the steps draw it, so it is not drawn twice. */}
        {!mobile && (
          <VisuallyHidden>
            <Text role="status">{item ? `${step + 1} av ${items.length}` : 'Översikt'}</Text>
          </VisuallyHidden>
        )}
        <Stepper
          activeStep={step}
          label="Rader"
          onStepClick={n => {
            if (!sending) goTo(n);
          }}
          horizontalOptions={{ minimumStepWidth: 112, collapsedVariant: 'hiddenLabel' }}
        >
          {steps}
        </Stepper>
        {mobile && between}
      </>
    ) : items.length >= 5 ? (
      <VStack gap={3}>
        <ProgressBar
          label={readOnly ? 'Bekräftade rader' : 'Bedömda rader'}
          isLabelHidden
          variant="neutral"
          value={judged}
          max={items.length}
        />
        <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
          {between}
          <HStack gap={3} vAlign="center">
            <Text type="supporting">
              {judged} av {items.length} {readOnly ? 'bekräftade' : 'bedömda'}
            </Text>
            {/* Not on the canvas: with many rows the last step is otherwise a press per row away. */}
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                label="Översikt"
                isDisabled={last || sending}
                onClick={() => goTo(items.length)}
              />
            )}
          </HStack>
        </HStack>
      </VStack>
    ) : null;
  // "Granska avvisade igen" (D80) is the notice's move where the state's own would have led here: a new item with the
  // refused rows takes this one's place, its way back where this one was opened from.
  const retry =
    ['failed', 'partial'].includes(thread.execution?.state ?? '') &&
    thread.receipt?.rows.some(r => r.outcome === 'failed')
      ? {
          label: 'Granska avvisade igen',
          clickAction: async () => {
            await run(async () => {
              const next = await api.retryRejected(thread.id);
              navigate(retriedReviewHref(from, thread.id, next.id), { replace: true });
              return next;
            });
          },
        }
      : undefined;
  const itemActions = {
    thread: live,
    actions: about.actions,
    readHref: about.readHref,
    omit: about.omit,
    titleRef: about.title,
  };
  // ⋯ with what else the item offers (its reads, Inte nu, Avfärda, the state's other moves): at the end of the title's
  // line, where the canvas has it.
  const menu = <ActionRow {...itemActions} part="menu" />;
  const badge = dueBadge(live, today(), about.actions.status);
  const unsent = readOnly ? undefined : 'Inget skrivs förrän du skickar';
  // Under the title: the item's notice once something has happened (not while this page's own send is on its way: the
  // button says that), what the item notes, and the rows as steps.
  const headBelow = (
    <VStack gap={mobile ? 3 : 4}>
      {!sending && <ActionRow {...itemActions} part="notice" retry={retry} />}
      <Notes thread={live} item={about} status={about.actions.status} />
      {readOnly && error && (
        <Text as="p" role="alert">
          {error}
        </Text>
      )}
      {progress}
    </VStack>
  );
  // On a phone the whole head scrolls with the step (it is in the column, not the frame's header).
  const head = (
    <VStack gap={3}>
      <HStack gap={4} wrap="wrap" vAlign="center">
        <WayBack back={back} />
        {trailLine}
      </HStack>
      <VStack gap={1}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading ref={about.title} tabIndex={-1} level={1}>
            {thread.title}
          </Heading>
          {badge}
        </HStack>
        {unsent && (
          <Text type="supporting" color="secondary">
            {unsent}
          </Text>
        )}
      </VStack>
      <HStack>{menu}</HStack>
      {headBelow}
    </VStack>
  );
  const stepBody = completed ? (
    <VStack gap={3} paddingBlock={10} role="status" aria-label="Bekräftat av källan">
      <CompletionFeedback title="Klart" detail={completed.headline} />
      <Text type="supporting">Bekräftat av {source}.</Text>
    </VStack>
  ) : item ? (
    <VStack gap={4} width="100%">
      {decision}
      {/* Not on the canvas: what the document is, once the decision is sent, was said in the review's header. */}
      {readOnly && (
        <Text as="p" type="supporting">
          Underlaget visar källans nuvarande version.
        </Text>
      )}
      {paper}
    </VStack>
  ) : (
    summary
  );
  // Until it is sent, the decision is in the footer; after that the notice under the title carries the one move.
  const footer =
    completed || readOnly ? undefined : (
      <LayoutFooter padding={mobile ? 3 : 6} hasDivider label="Granskningens beslut">
        <VStack gap={2}>
          {item && !canApprove && (
            <Text role="status" type="supporting">
              Öppna och läs de underlag som krävs innan du godkänner.
            </Text>
          )}
          <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
            {!mobile && (
              <Text type="supporting">
                {last ? 'Skicka dina val till ' + source + '.' : 'Dina val skickas i sista steget.'}
              </Text>
            )}
            {item ? (
              <HStack gap={2} wrap="wrap" justify="end" width={mobile ? '100%' : undefined}>
                <Button variant="ghost" label="Hoppa över" onClick={() => goTo(step + 1)} />
                <Button variant="secondary" label="Lämna kvar" onClick={() => decide('leave')} />
                <Button
                  ref={primary}
                  variant="primary"
                  label={verb}
                  isDisabled={!canApprove}
                  onClick={() => decide('approve')}
                />
              </HStack>
            ) : (
              <Button
                ref={approved.length ? primary : undefined}
                variant="primary"
                label={`${verb} ${approved.length}`}
                isDisabled={approved.length === 0}
                isLoading={sending}
                onClick={() => {
                  if (!sending) void send();
                }}
              />
            )}
          </HStack>
        </VStack>
      </LayoutFooter>
    );
  // The item about itself: in the end panel, and after the row where the window is narrow or the assistant's pane has
  // the end slot (D136 item 9). From five rows the rows are a list before the facts.
  const aboutItem = (inColumn: boolean) => (
    <ItemAbout
      thread={live}
      item={about}
      rows={items.length >= 5 ? soFar(inColumn) : undefined}
      {...(inColumn ? { columns: 'multi' as const } : {})}
    />
  );
  const column = (
    <VStack gap={6}>
      {mobile && head}
      {stepBody}
      {!completed && (
        <FactsInColumn query={narrowPageQuery}>{inColumn => (inColumn ? aboutItem(true) : null)}</FactsInColumn>
      )}
    </VStack>
  );
  // About the work item, as on every item's page (D136 item 6).
  const ask = { subject: itemPageSubject(thread) };
  if (where === null)
    return (
      <PageFrame ask={ask}>
        <EmptyState
          headingLevel={1}
          title="Steget finns inte"
          description={`Granskningen har ${items.length + 1} steg: en rad i taget och sist Skicka.`}
          actions={<Button label="Till första steget" href={atStep(pathname, search, 0)} />}
        />
      </PageFrame>
    );
  return mobile ? (
    <PageFrame ask={ask} label="Ärendet" scrollTabStop footer={footer}>
      {column}
    </PageFrame>
  ) : (
    <PageFrame
      ask={ask}
      back={back}
      trail={trailLine}
      title={thread.title}
      titleRef={about.title}
      status={badge}
      meta={unsent}
      actions={menu}
      below={headBelow}
      label="Ärendet"
      scrollTabStop
      facts={completed ? undefined : aboutItem(false)}
      factsAbove={false}
      footer={footer}
    >
      {column}
    </PageFrame>
  );
}
