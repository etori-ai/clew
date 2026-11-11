import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Thread, ThreadAction, ReviewEvidence, Receipt } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  CompletionFeedback,
  Drawer,
  DrawerHeader,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  Lightbox,
  List,
  ListItem,
  ProgressBar,
  Skeleton,
  StackItem,
  Step,
  Stepper,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { previewQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { useOverlayTitle } from '../page-title';
import { useMarks } from '../marks';
import { expectReceipt } from '../linger';
import {
  reviewOf,
  reviewReturn,
  stepOf,
  withRetriedReview,
  withReview,
  withoutReview,
  type ReviewReturn,
} from '../review-address';
import { mobileQuery, shortQuery } from './shell';
import { reviewedAction, useCardAction } from './card';
import { receiptComplete } from '../receipt-state';
import { DocumentReader } from './document-reader';
import { ReviewRecovery } from './review-recovery';
import { api } from '../api';

type Decision = 'approve' | 'leave';
const decisionWord: Record<Decision, string> = { approve: 'Vald för godkännande', leave: 'Lämnas kvar' };
/** The verb of the action, for its buttons: "Attestera valda" is "Attestera" on one row. */
const verbOf = (action: ThreadAction) => action.label.replace(/\s+valda$/i, '');
/** A card that is reviewed: open, not yet decided, with an execute that asks for a review one row at a time (D70). */
const reviewable = (thread: Thread | undefined) => (thread ? reviewedAction(thread) : undefined);
const submitted = (thread: Thread) =>
  !!thread.receipt ||
  thread.state !== 'open' ||
  (!!thread.execution && !(thread.execution.compensates && thread.execution.state === 'succeeded'));
/**
 * The drawer's desktop width budget (D73 amended): a readable document with the rail and the column's edge still
 * in sight behind the scrim. On a phone the review is a sheet
 * instead (D73, second amendment).
 */
const REVIEW_WIDTH = 1040;

/**
 * The review one row at a time (D70 item 2) as an overlay over the page it was opened on (D73, amended 2026-11-07 and
 * 2026-11-11 under D110 rule 5): an Astryx `Drawer` from the end edge, and on a phone a tall `BottomSheet`, stacked over
 * the card's sheet where the card is one, Astryx's drill-in (D73, second amendment). Mounted once for every page of the
 * session, after the page in the tree (`main.tsx`), so a cold open stacks it over the card the same update opens: the
 * page's own drawer, Hem's sheet or the shell's drawer over Kalender (Astryx: sibling overlays opened together stack in
 * tree order, last-opened on top, and Esc closes the top one only). The address names it (`?review=<threadId>`, with
 * `step` rewritten in place) on whichever page it lies over; on every other address it draws nothing. Closing (✕, Esc,
 * the scrim, a swipe on the sheet, "Tillbaka till kortet", Skicka's answer) keeps the decisions: the overlay slides
 * away first and then replaces the address with the same one without `review` and `step`, the decisions as the entry's
 * state laid over the card's selection, so the page (or the card's sheet or drawer) is no longer inert when the card
 * puts the focus back on its "Granska N", wherever the card is drawn. The decisions live here, above the surface, so a
 * resize across the phone's width swaps the drawer for the sheet without losing them. The card comes from the threads
 * list, the cache every page's cards are drawn from (D33). A card that is not reviewed, or a step it does not have,
 * says so inside the overlay, where the ✕ is the way out.
 */
export function ReviewOverlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const threadId = reviewOf(search);
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing in the overlay is pinned; it scrolls as one.
  const short = useMediaQuery(shortQuery);
  const threadsQ = useQuery(threadsQuery);
  // One review, from the address naming it until the overlay has slid away: the card, the step the address last named
  // (kept while the overlay leaves, so the step does not change under the slide), and the decisions taken in it.
  const [held, setHeld] = useState<{ threadId: string; open: boolean } | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [evidence, setEvidence] = useState<Record<string, ReviewEvidence>>({});
  // Where the overlay leads once it has slid away, set by a close or by Skicka; null while it stays.
  const [leaving, setLeaving] = useState<{ to: string; state?: ReviewReturn } | null>(null);
  // While the decision is on its way the card turns handled under the overlay: the review keeps the card it was sending
  // from until it has led back to the page under it.
  const [sending, setSending] = useState(false);
  if (threadId && !leaving && (!held || !held.open || held.threadId !== threadId)) {
    setHeld({ threadId, open: true });
    setDecisions({});
    setEvidence({});
    setSending(false);
  } else if (!threadId && leaving) {
    // The overlay has slid away and the address it led to has landed: the review is over.
    setHeld(null);
    setLeaving(null);
    setSending(false);
  } else if (!threadId && held?.open) setHeld({ ...held, open: false });
  const lastSearch = useRef(search);
  if (threadId) lastSearch.current = search;

  const shownId = held?.threadId ?? null;
  const live = shownId ? threadsQ.data?.threads.find(t => t.id === shownId) : undefined;
  const kept = useRef<{ thread: Thread; action: ThreadAction } | null>(null);
  const action = reviewable(live);
  if (live && action && !sending) kept.current = { thread: live, action };
  const shown =
    sending && kept.current?.thread.id === shownId ? kept.current : live && action ? { thread: live, action } : null;
  const readOnly = !!shown && submitted(shown.thread);
  const items = shown ? shown.thread.items.filter(i => i.selectable) : [];
  const step = shown ? stepOf(lastSearch.current, items.length + 1) : null;
  const missing = threadsQ.data !== undefined && !shown;
  const failed = threadsQ.isError && threadsQ.data === undefined;
  // The overlay opens once the threads are read, in the same commit as the card under it: where the card is itself a
  // drawer, the one shown last stacks on top, and on a phone two sheets opened in one update stack in tree order, so the
  // review, written after the page and everything it draws, is the top one. Until then the page draws its own loading
  // state under the address.
  // A resize across the phone's width swaps the drawer for the sheet (or back) while the card under it swaps too. Opened
  // in that same commit, or one commit later, the new surface came out beneath the card's (measured in both directions:
  // the card's sheet or drawer on top), so it opens a frame later, over the card already presented. A cold open is not
  // a swap: both open in one update and tree order decides.
  const [surface, setSurface] = useState(mobile);
  const swapping = surface !== mobile;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSurface(mobile));
    return () => cancelAnimationFrame(frame);
  }, [mobile]);
  const isOpen = !!threadId && !leaving && !swapping && (threadsQ.data !== undefined || failed);
  const title = shown
    ? step === null
      ? 'Steget finns inte'
      : `${readOnly ? 'Visa' : 'Granska'} ${items.length} ${items.length === 1 ? 'rad' : 'rader'}`
    : missing
      ? 'Kortet finns inte'
      : 'Granskning';
  // The document title names the review while it is open, and the page's own comes back when it closes. The overlay
  // says its name itself when the focus enters it, so the title is not spoken.
  useOverlayTitle(isOpen && (shown || missing) ? title : null);

  const approved = items.filter(i => decisions[i.ref] === 'approve').map(i => i.ref);
  const left = items.filter(i => decisions[i.ref] === 'leave').map(i => i.ref);
  /**
   * Back to the page under the review as it was, with the card open where it was; when the card is not there, the page
   * without it. With the decisions when there was a step to take them on.
   */
  const leave = (state?: ReviewReturn) =>
    setLeaving({
      to: withoutReview(location.pathname, location.search, live ? undefined : (shownId ?? undefined)),
      ...(state ? { state } : {}),
    });
  // ✕, Esc and the scrim save and close, as "Spara och stäng" did (D73 item 3); nothing closes while Skicka waits on the source.
  const onOpenChange = (open: boolean) => {
    if (open || sending || leaving) return;
    // A sent card's review is read, not decided: it hands back no decisions, only the way back to "Granska N".
    leave(
      shown && step !== null
        ? reviewReturn(shown.thread.id, readOnly ? [] : approved, readOnly ? [] : left)
        : undefined,
    );
  };
  // The overlay has slid away and given the focus back (to the page, or into the card's sheet it revealed): now the
  // address follows. Leading back replaces the review's entry, so Back from the card goes where the person was before
  // the review. Nothing is reset until that address has landed, or the overlay would open again for the render in
  // between. A close that the address made (Back) leads nowhere and ends the review here; a close while the address
  // still names the review is the surface being swapped on a resize, and ends nothing.
  // The drawer's ref is its dialog; the sheet's is its panel, inside its dialog.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      const to = leavingRef.current;
      if (to) {
        navigate(to.to, { replace: true, ...(to.state ? { state: to.state } : {}) });
        return;
      }
      if (threadRef.current) return;
      setHeld(null);
      setSending(false);
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog, navigate]);

  // The drawer's header is Astryx's `DrawerHeader`. The sheet has no header of its own (its label names it): the first
  // row is composed as the card's sheet composes its own, the title as the h2 at the start and the ✕ at the end, with
  // the name Astryx gives the drawer's ✕, "Stäng".
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
  const message = (content: React.ReactNode) => (
    <Layout height={short ? 'auto' : 'fill'} header={header()} content={<LayoutContent>{content}</LayoutContent>} />
  );
  const body = !held ? null : shown && step !== null ? (
    <Review
      thread={shown.thread}
      live={live ?? shown.thread}
      action={shown.action}
      readOnly={readOnly}
      onClose={() => onOpenChange(false)}
      step={step}
      decisions={decisions}
      evidence={evidence}
      onDecide={(ref, d, proof) => {
        setDecisions(prev => ({ ...prev, [ref]: d }));
        setEvidence(prev => {
          const next = { ...prev };
          delete next[ref];
          if (proof && d === 'approve') next[ref] = proof;
          return next;
        });
      }}
      onInvalidate={ref => {
        setDecisions(prev => {
          const next = { ...prev };
          delete next[ref];
          return next;
        });
        setEvidence(prev => {
          const next = { ...prev };
          delete next[ref];
          return next;
        });
      }}
      sending={sending}
      onSending={setSending}
      onSent={() => {
        expectReceipt(shown.thread.id);
        leave();
      }}
      header={header(
        `${shown.thread.title} · ${readOnly ? 'resultat och underlag' : 'inget skrivs förrän du skickar'}`,
      )}
      phone={mobile}
    />
  ) : shown ? (
    message(
      <VStack gap={3}>
        <Text as="p">Granskningen har {items.length + 1} steg: en rad i taget och sist Skicka.</Text>
        <HStack>
          <Button label="Till första steget" href={withReview(location.pathname, location.search, shown.thread.id)} />
        </HStack>
      </VStack>,
    )
  ) : missing ? (
    message(
      <Text as="p">Det finns inget att granska här: kortet har ingen granskning, eller så har adressen ändrats.</Text>,
    )
  ) : failed ? (
    message(
      <Banner status="error" title={errorMessage(threadsQ.error, 'Granskningen kunde inte läsas.')}>
        <Button label="Försök igen" size="sm" variant="secondary" onClick={() => void threadsQ.refetch()} />
      </Banner>,
    )
  ) : null;
  // On a phone (D73, second amendment): a tall sheet over the card's sheet, `info` so a swipe, the scrim and Esc close
  // it as the ✕ does, with the padding the card's sheet has (the theme's default).
  return mobile ? (
    <BottomSheet
      ref={sheetPanel}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={title}
      height="tall"
      purpose="info"
    >
      {body}
    </BottomSheet>
  ) : (
    <Drawer
      ref={setDialog}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={title}
      side="end"
      width={REVIEW_WIDTH}
      padding={6}
    >
      {body}
    </Drawer>
  );
}

/**
 * The review itself (D70, D73): a constant-size navigator and an overview for any batch size. The document owns
 * the content region; the footer owns the action's verb, Lämna kvar and Hoppa över. Nothing
 * is written until the last step's one button, which runs the same execute with the approved refs through the card's
 * own action (`useCardAction`). No text input (D12): a question about a row is asked in the conversation afterwards.
 */
function Review({
  thread,
  live,
  action,
  readOnly,
  onClose,
  step,
  decisions,
  evidence,
  onDecide,
  onInvalidate,
  sending,
  onSending,
  onSent,
  header,
  phone,
}: {
  thread: Thread;
  /** The thread as the cache has it now, which says when the source's answer has come to rest. */
  live: Thread;
  action: ThreadAction;
  readOnly: boolean;
  onClose: () => void;
  step: number;
  decisions: Record<string, Decision>;
  evidence: Record<string, ReviewEvidence>;
  onDecide: (ref: string, decision: Decision, evidence?: ReviewEvidence) => void;
  onInvalidate: (ref: string) => void;
  sending: boolean;
  onSending: (sending: boolean) => void;
  /** The source has answered: the overlay leads back to the card, where the row keeps its place with the receipt. */
  onSent: () => void;
  header: React.ReactNode;
  /** On a phone the review is a sheet (D73, second amendment): the footer drops the sentence about Esc. */
  phone: boolean;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const short = useMediaQuery(shortQuery);
  const items = thread.items.filter(i => i.selectable);
  const [zoom, setZoom] = useState(false);
  const item = items[step];
  const last = step >= items.length;
  const approved = items.filter(i => decisions[i.ref] === 'approve').map(i => i.ref);
  const left = items.filter(i => decisions[i.ref] === 'leave').length;
  const undecided = items.filter(i => !decisions[i.ref]).length;
  const verb = verbOf(action);
  const mark = useMarks().ofThread(thread);
  const source = thread.trigger.source;
  // A step is a place in the address, rewritten in place, so the browser's Back leaves the review (D73 item 1).
  const goTo = (n: number) => navigate(withReview(pathname, search, thread.id, n), { replace: true });
  const decide = (d: Decision) => {
    if (!item || readOnly) return;
    onDecide(item.ref, d, documents?.evidence);
    goTo(step + 1);
  };
  // Skicka is the card's own execute (D45/D47): the button keeps loading until the source's answer has come to rest,
  // and only then does the overlay lead back to the card, where the row keeps its place with the receipt (D70 item 1).
  // The mutation response can arrive before the list query notifies this render. Keep that confirmed answer too.
  const response = useRef<Thread | null>(null);
  const { settling, error, perform, run, confirmation } = useCardAction({
    thread: live,
    onChange: thread => {
      response.current = thread;
    },
  });
  const [sent, setSent] = useState(false);
  const [completed, setCompleted] = useState<Receipt | null>(null);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const send = async () => {
    if (readOnly) return;
    response.current = null;
    onSending(true);
    const ran = await perform(
      action,
      approved,
      approved.flatMap(ref => (evidence[ref] ? [evidence[ref]!] : [])),
    );
    if (ran) setSent(true);
    else onSending(false);
  };
  useEffect(() => {
    if (!sent || settling) return;
    setSent(false);
    if (error) {
      onSending(false);
      return;
    }
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
  // when there is nothing to send. A frame later, so the overlay has been shown and its page made inert first. On a
  // phone a step opens on its document instead (D73, second amendment): the verb stands under the document, and focusing
  // it scrolled the sheet so the document was above the fold, which is the one thing a review is for. Enter is not the
  // way on a touch screen; the verb is a thumb's reach under the document.
  const primary = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const paperHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      (
        (phone || readOnly
          ? paperHeading.current
          : // From Astryx 0.7.12 a disabled Button says so with aria-disabled and keeps its place in the tab order.
            primary.current?.disabled || primary.current?.getAttribute('aria-disabled') === 'true'
            ? paperHeading.current
            : primary.current) ?? heading.current
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [step, phone, readOnly]);
  const preview = useQuery({ ...previewQuery(thread.id, item?.ref ?? '', item?.revision), enabled: !!item });
  const documents = preview.data && 'kind' in preview.data ? preview.data : undefined;
  const legacy = preview.data && 'mediaType' in preview.data ? preview.data : undefined;
  const dataUrl = legacy ? `data:${legacy.mediaType};base64,${legacy.data}` : null;
  const isImage = !!legacy && legacy.mediaType !== 'application/pdf';
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
    if (!phone && legacy && canApprove && document.activeElement === paperHeading.current) primary.current?.focus();
  }, [phone, legacy, canApprove]);
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
  const soFar = (
    <Card padding={3}>
      <List density="compact" hasDividers aria-label="Hittills">
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
                  onClick={() => goTo(n)}
                />
              ) : undefined
            }
          />
        ))}
      </List>
    </Card>
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
            <Button size="sm" variant="secondary" label="Försök igen" onClick={() => void preview.refetch()} />
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
          // A native image is the one thing here Astryx has no component for: it is sized to its column and nothing more.
          <img src={dataUrl} alt={legacy!.title} style={{ display: 'block', width: '100%', height: 'auto' }} />
        ) : dataUrl ? (
          <VStack gap={2}>
            <Text>{legacy!.title}</Text>
            <Button size="sm" variant="secondary" label="Hämta underlaget (PDF)" href={dataUrl} />
          </VStack>
        ) : null}
      </Card>
      {dataUrl && isImage && (
        <Lightbox isOpen={zoom} onOpenChange={setZoom} media={{ src: dataUrl, alt: legacy!.title }} hasZoom />
      )}
    </VStack>
  );
  // The overlay's title is the h2; a row and the summary are the level under it.
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
      <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={3}>
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
            onInvalidate(item.ref);
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
        <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={3}>
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
      {soFar}
      {!readOnly && (
        <Card padding={3} variant="muted">
          <VStack gap={1.5}>
            <Text weight="semibold">Vad som händer när du skickar</Text>
            <Text as="p" type="supporting">
              {verb} skrivs till {source} i ett beslut och läses tillbaka rad för rad som kvitto. Grönt bara när{' '}
              {source} har bekräftat. Kortet går till Klart
              {left + undecided > 0
                ? `; det som lämnas kvar ligger kvar på kortet och kommer som ett eget kort vid nästa genomgång.`
                : '.'}
            </Text>
          </VStack>
        </Card>
      )}
      {error && !sending && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {confirmation}
    </VStack>
  );
  const flowStatus = readOnly ? (
    <Badge
      variant={receiptComplete(thread.receipt) ? 'success' : 'warning'}
      icon={<Icon icon={receiptComplete(thread.receipt) ? 'check' : 'clock'} />}
      label={receiptComplete(thread.receipt) ? 'Bekräftat' : 'Behöver följas upp'}
    />
  ) : sending ? (
    <Badge variant="info" icon={<Icon icon="clock" />} label="Skickar" />
  ) : error ? (
    <Badge variant="error" icon={<Icon icon="info" />} label="Kunde inte skicka" />
  ) : undecided > 0 ? (
    <Badge variant="neutral" icon={<Icon icon="clock" />} label="Granskning pågår" />
  ) : approved.length > 0 ? (
    <Badge variant="info" icon={<Icon icon="check" />} label="Redo att skicka" />
  ) : (
    <Badge variant="neutral" icon={<Icon icon="clock" />} label="Inget att skicka" />
  );
  if (completed)
    return (
      <Layout
        height={short ? 'auto' : 'fill'}
        header={header}
        content={
          <LayoutContent>
            <VStack gap={3} paddingBlock={10} role="status" aria-label="Bekräftat av källan">
              <CompletionFeedback title="Klart" detail={completed.headline} />
              <Text type="supporting">Bekräftat av {source}. Kvittot finns på kortet.</Text>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <Button label="Visa kvittot" onClick={onSent} />
          </LayoutFooter>
        }
      />
    );
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      defaultHasDividers
      header={header}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <AreaChip ordinal={mark.ordinal} label={mark.title} {...(mark.icon ? { icon: mark.icon } : {})} />
                <Text type="supporting">{mark.source}</Text>
              </HStack>
              <HStack gap={2} vAlign="center" wrap="wrap">
                {flowStatus}
                <Text type="supporting">
                  {readOnly
                    ? (thread.receipt?.rows.filter(r => r.outcome === 'done').length ?? 0)
                    : items.length - undecided}{' '}
                  av {items.length} {readOnly ? 'bekräftade' : 'bedömda'}
                </Text>
              </HStack>
            </HStack>
            {items.length > 1 && items.length < 5 ? (
              <Stepper
                activeStep={step}
                label="Rader"
                onStepClick={n => {
                  if (!sending) goTo(n);
                }}
                horizontalOptions={{ minimumStepWidth: 112, collapsedVariant: 'hiddenLabel' }}
              >
                {items.map((i, n) => (
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
                ))}
                <Step
                  step={items.length}
                  label={readOnly ? 'Resultat' : 'Skicka'}
                  indicator="number"
                  isDisabled={sending}
                />
              </Stepper>
            ) : items.length >= 5 ? (
              <ProgressBar
                label={readOnly ? 'Bekräftade rader' : 'Bedömda rader'}
                isLabelHidden
                variant="neutral"
                value={
                  readOnly
                    ? (thread.receipt?.rows.filter(r => r.outcome === 'done').length ?? 0)
                    : items.length - undecided
                }
                max={items.length}
              />
            ) : null}
            <HStack justify="between" vAlign="center" gap={2}>
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
                  isDisabled={last || sending}
                  onClick={() => goTo(step + 1)}
                />
              </HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Översikt"
                isDisabled={last || sending}
                onClick={() => goTo(items.length)}
              />
            </HStack>
            {readOnly && (
              <Text as="p" type="supporting">
                Kvittot visar beslutets resultat. Underlagen visar källans nuvarande version.
              </Text>
            )}
            {item ? (
              <VStack gap={4} width="100%" maxWidth={800}>
                {decision}
                {paper}
              </VStack>
            ) : (
              summary
            )}
          </VStack>
        </LayoutContent>
      }
      footer={
        readOnly ? (
          <LayoutFooter>
            <VStack gap={2}>
              {error && <Text role="alert">{error}</Text>}
              <HStack gap={2} wrap="wrap">
                <Button label="Tillbaka till kortet" onClick={onClose} />
                {['failed', 'partial'].includes(thread.execution?.state ?? '') &&
                  thread.receipt?.rows.some(r => r.outcome === 'failed') && (
                    <Button
                      label="Granska avvisade igen"
                      clickAction={() =>
                        run(async () => {
                          const next = await api.retryRejected(thread.id);
                          // The new card's review in this one's place, over the same page (D80, D110 rule 5).
                          navigate(withRetriedReview(pathname, search, thread.id, next.id));
                          return next;
                        })
                      }
                    />
                  )}
                {thread.execution && ['pending', 'running', 'unknown'].includes(thread.execution.state) && (
                  <Button label="Kontrollera status" clickAction={() => run(() => api.checkExecution(thread.id))} />
                )}
              </HStack>
            </VStack>
          </LayoutFooter>
        ) : (
          <LayoutFooter label="Granskningens beslut">
            <VStack gap={2}>
              {item && !canApprove && (
                <Text role="status" type="supporting">
                  Öppna och läs de underlag som krävs innan du godkänner.
                </Text>
              )}
              <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
                {!phone && (
                  <Text type="supporting">
                    {last ? 'Skicka dina val till ' + source + '.' : 'Dina val skickas i sista steget.'}
                  </Text>
                )}
                {item ? (
                  <HStack gap={2} wrap="wrap" justify="end" width={phone ? '100%' : undefined}>
                    <Button variant="ghost" label="Hoppa över" onClick={() => goTo(step + 1)} />
                    <Button variant="secondary" label="Lämna kvar" onClick={() => decide('leave')} />
                    <Button
                      ref={primary}
                      {...(phone ? {} : { 'data-autofocus': '' })}
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
        )
      }
    />
  );
}
