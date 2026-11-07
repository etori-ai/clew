import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Thread, ThreadAction, ThreadItem } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  Drawer,
  DrawerHeader,
  Grid,
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
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { expectReceipt } from '../linger';
import { withCard } from '../panel-address';
import { reviewHref, reviewReturn, stepOf, type ReviewReturn } from '../review-address';
import { mobileQuery, shortQuery } from './shell';
import { reviewedAction, useCardAction } from './card';

type Decision = 'approve' | 'leave';
const decisionWord: Record<Decision, string> = { approve: 'Godkänd', leave: 'Lämnas kvar' };
/** The verb of the action, for its buttons: "Attestera valda" is "Attestera" on one row. */
const verbOf = (action: ThreadAction) => action.label.replace(/\s+valda$/i, '');
/** A row's short name for the stepper: what stands before the first " · " of its label. */
const shortLabel = (item: ThreadItem) => item.label.split(' · ')[0] ?? item.label;
/** The card beside Hem, where the review leads back to (D73). */
const cardAddress = (threadId: string) => withCard('/', '', threadId);
/** A card that is reviewed: open, not yet decided, with an execute that asks for a review one row at a time (D70). */
const reviewable = (thread: Thread | undefined) =>
  thread && thread.state === 'open' && !thread.receipt ? reviewedAction(thread) : undefined;
/**
 * The drawer's desktop width budget (D73 amended): room for the document beside the decision, two columns of 360 px
 * and the inset, with the rail and the column's edge still in sight behind the scrim. On a phone the review is a sheet
 * instead (D73, second amendment).
 */
const REVIEW_WIDTH = 1040;

/**
 * The review one row at a time (D70 item 2) as an overlay over Hem (D73, amended 2026-11-07: an overlay, not a page of
 * its own): an Astryx `Drawer` from the end edge, and on a phone, where the card is itself a `BottomSheet`, a tall
 * `BottomSheet` stacked over the card's sheet, Astryx's drill-in (D73, second amendment). The route
 * `/cards/:threadId/review` draws Hem with the card beside the column (or in its sheet), as `/?card=` does, and this
 * overlay over it; `threadId` is the card the route names, null on every other start route. The step is the address's
 * `step`, rewritten in place. Closing (✕, Esc, the scrim, a swipe on the sheet) keeps the decisions: the overlay slides
 * away first and then leads to `/?card=<threadId>` with them as the card's selection, so the page (or the card's sheet)
 * is no longer inert when the card puts the focus back on its "Granska N". The decisions live here, above the surface,
 * so a resize across the phone's width swaps the drawer for the sheet without losing them. The card comes from the
 * threads list, the cache Hem's cards are drawn from (D33). A card that is not reviewed, or a step it does not have,
 * says so inside the overlay, where the ✕ is the way out.
 */
export function ReviewOverlay({ threadId }: { threadId: string | null }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing in the overlay is pinned; it scrolls as one.
  const short = useMediaQuery(shortQuery);
  const threadsQ = useQuery(threadsQuery);
  // One review, from the address naming it until the overlay has slid away: the card, the step the address last named
  // (kept while the overlay leaves, so the step does not change under the slide), and the decisions taken in it.
  const [held, setHeld] = useState<{ threadId: string; open: boolean } | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Where the overlay leads once it has slid away, set by a close or by Skicka; null while it stays.
  const [leaving, setLeaving] = useState<{ to: string; state?: ReviewReturn } | null>(null);
  // While the decision is on its way the card turns handled under the overlay: the review keeps the card it was sending
  // from until it has led back to Hem.
  const [sending, setSending] = useState(false);
  if (threadId && !leaving && (!held || !held.open || held.threadId !== threadId)) {
    setHeld({ threadId, open: true });
    setDecisions({});
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
  if (live && action) kept.current = { thread: live, action };
  const shown =
    live && action ? { thread: live, action } : sending && kept.current?.thread.id === shownId ? kept.current : null;
  const items = shown ? shown.thread.items.filter(i => i.selectable) : [];
  const step = shown ? stepOf(lastSearch.current, items.length + 1) : null;
  const missing = threadsQ.data !== undefined && !shown;
  const failed = threadsQ.isError && threadsQ.data === undefined;
  // The overlay opens once the threads are read, in the same commit as the card under it: where the card is itself a
  // drawer, the one shown last stacks on top, and on a phone two sheets opened in one update stack in tree order, so the
  // review, written after the card's sheet in `StartPage`, is the top one. Until then Hem draws its own loading state
  // under the address.
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
      : `Granska ${items.length} rader`
    : missing
      ? 'Kortet finns inte'
      : 'Granskning';
  // The document title names the review while it is open; Hem's own title comes back with Hem's address. The overlay
  // says its name itself when the focus enters it, so the title is not spoken.
  usePageTitle(isOpen && (shown || missing) ? title : null, false);

  const approved = items.filter(i => decisions[i.ref] === 'approve').map(i => i.ref);
  /** Back to the card beside Hem, or to Hem when the card is not there; with the decisions when there was a step to take them on. */
  const leave = (state?: ReviewReturn) =>
    setLeaving({ to: live ? cardAddress(live.id) : '/', ...(state ? { state } : {}) });
  // ✕, Esc and the scrim save and close, as "Spara och stäng" did (D73 item 3); nothing closes while Skicka waits on the source.
  const onOpenChange = (open: boolean) => {
    if (open || sending || leaving) return;
    leave(shown && step !== null ? reviewReturn(shown.thread.id, approved) : undefined);
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
      step={step}
      decisions={decisions}
      onDecide={(ref, d) => setDecisions(prev => ({ ...prev, [ref]: d }))}
      sending={sending}
      onSending={setSending}
      onSent={() => {
        expectReceipt(shown.thread.id);
        leave();
      }}
      header={header(`${shown.thread.title} · inget skrivs förrän du skickar`)}
      phone={mobile}
    />
  ) : shown ? (
    message(
      <VStack gap={3}>
        <Text as="p">Granskningen har {items.length + 1} steg: en rad i taget och sist Skicka.</Text>
        <HStack>
          <Button label="Till första steget" href={reviewHref(shown.thread.id)} />
        </HStack>
      </VStack>,
    )
  ) : missing ? (
    message(
      <Text as="p">
        Det finns inget att granska här: kortet är redan klart, har ingen granskning, eller så har adressen ändrats.
      </Text>,
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
 * The review itself (D70 artboards B and C, D73): the mark row and the horizontal Stepper above, one step at a time,
 * the row's document beside its decision as the `checkout-wizard` template's two columns, which stack where both do
 * not fit, and Föregående and Nästa in the footer. Each row gets the action's verb, Lämna kvar and Hoppa över. Nothing
 * is written until the last step's one button, which runs the same execute with the approved refs through the card's
 * own action (`useCardAction`). No text input (D12): a question about a row is asked in the conversation afterwards.
 */
function Review({
  thread,
  live,
  action,
  step,
  decisions,
  onDecide,
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
  step: number;
  decisions: Record<string, Decision>;
  onDecide: (ref: string, decision: Decision) => void;
  sending: boolean;
  onSending: (sending: boolean) => void;
  /** The source has answered: the overlay leads back to the card, where the row keeps its place with the receipt. */
  onSent: () => void;
  header: React.ReactNode;
  /** On a phone the review is a sheet (D73, second amendment): the footer drops the sentence about Esc. */
  phone: boolean;
}) {
  const navigate = useNavigate();
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
  const source = thread.trigger.source.toLowerCase();
  // A step is a place in the address, rewritten in place, so the browser's Back leaves the review (D73 item 1).
  const goTo = (n: number) => navigate(reviewHref(thread.id, n), { replace: true });
  const decide = (d: Decision) => {
    if (!item) return;
    onDecide(item.ref, d);
    goTo(step + 1);
  };
  // Skicka is the card's own execute (D45/D47): the button keeps loading until the source's answer has come to rest,
  // and only then does the overlay lead back to the card, where the row keeps its place with the receipt (D70 item 1).
  const { settling, error, perform } = useCardAction({ thread: live });
  const [sent, setSent] = useState(false);
  const send = async () => {
    onSending(true);
    const ran = await perform(action, approved);
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
    onSent();
  }, [sent, settling, error]);
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
      ((phone ? paperHeading.current : primary.current) ?? heading.current)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [step, phone]);
  const preview = useQuery({ ...previewQuery(thread.id, item?.ref ?? ''), enabled: !!item });
  const dataUrl = preview.data ? `data:${preview.data.mediaType};base64,${preview.data.data}` : null;
  const isImage = !!preview.data && preview.data.mediaType !== 'application/pdf';
  // A decided row carries its mark; a row not yet looked at has none, and its description says so.
  const decisionIcon = (ref: string) =>
    decisions[ref] === 'approve' ? (
      <Icon icon="check" color="success" label="Godkänd" />
    ) : decisions[ref] === 'leave' ? (
      <Icon icon="clock" color="secondary" label="Lämnas kvar" />
    ) : undefined;
  const soFar = (
    <Card padding={3}>
      <List density="compact" hasDividers aria-label="Hittills">
        {items.map((i, n) => (
          <ListItem
            key={i.ref}
            startContent={decisionIcon(i.ref)}
            label={<Text weight={n === step ? 'semibold' : undefined}>{i.label}</Text>}
            description={n === step ? 'Det här' : decisions[i.ref] ? decisionWord[decisions[i.ref]!] : 'Inte bedömd än'}
            endContent={
              n !== step ? <Button size="sm" variant="ghost" label="Ändra" onClick={() => goTo(n)} /> : undefined
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
      <Card padding={2}>
        {preview.isPending ? (
          <Skeleton height={480} />
        ) : preview.isError ? (
          <VStack gap={2}>
            <Text as="p" role="alert">
              {errorMessage(preview.error, 'Underlaget kunde inte hämtas.')}
            </Text>
            <Button size="sm" variant="secondary" label="Försök igen" onClick={() => void preview.refetch()} />
          </VStack>
        ) : dataUrl && isImage ? (
          // A native image is the one thing here Astryx has no component for: it is sized to its column and nothing more.
          <img src={dataUrl} alt={preview.data!.title} style={{ display: 'block', width: '100%', height: 'auto' }} />
        ) : dataUrl ? (
          <VStack gap={2}>
            <Text>{preview.data!.title}</Text>
            <Button size="sm" variant="secondary" label="Hämta underlaget (PDF)" href={dataUrl} />
          </VStack>
        ) : null}
      </Card>
      {dataUrl && isImage && (
        <Lightbox isOpen={zoom} onOpenChange={setZoom} media={{ src: dataUrl, alt: preview.data!.title }} hasZoom />
      )}
    </VStack>
  );
  // The overlay's title is the h2; a row and the summary are the level under it.
  const decision = item && (
    <VStack gap={3}>
      {decisions[item.ref] && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge
            variant={decisions[item.ref] === 'approve' ? 'success' : 'neutral'}
            label={decisionWord[decisions[item.ref]!]}
          />
        </HStack>
      )}
      <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={3}>
        {item.label}
      </Heading>
      <Text as="p" color="secondary">
        {item.detail}
      </Text>
      <HStack gap={2} wrap="wrap">
        <Button
          ref={primary}
          {...(phone ? {} : { 'data-autofocus': '' })}
          size="lg"
          variant="primary"
          label={verb}
          onClick={() => decide('approve')}
        />
        <Button size="lg" variant="secondary" label="Lämna kvar" onClick={() => decide('leave')} />
        <Button size="lg" variant="ghost" label="Hoppa över" onClick={() => goTo(step + 1)} />
      </HStack>
      <Text type="supporting" as="p">
        Beslutet sparas som markering på kortet. Inget skrivs till {source} förrän du skickar i sista steget.
      </Text>
      {soFar}
    </VStack>
  );
  const summary = last && (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={3}>
          Det du valt
        </Heading>
        <Text as="p" color="secondary">
          {approved.length} av {items.length} skickas{left ? `, ${left} lämnas kvar` : ''}
          {undecided ? `, ${undecided} ${undecided === 1 ? 'är inte bedömd' : 'är inte bedömda'}` : ''}. Inget är
          skrivet än.
        </Text>
      </VStack>
      {soFar}
      <Card padding={3} variant="muted">
        <VStack gap={1.5}>
          <Text weight="semibold">Vad som händer när du skickar</Text>
          <Text as="p" type="supporting">
            {verb} skrivs till {source} i ett beslut och läses tillbaka rad för rad som kvitto. Grönt bara när {source}{' '}
            har bekräftat. Ångra i 10 minuter. Kortet går till Klart
            {left + undecided > 0
              ? `; det som lämnas kvar ligger kvar på kortet och kommer som ett eget kort vid nästa genomgång.`
              : '.'}
          </Text>
        </VStack>
      </Card>
      {error && !sending && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Button
          ref={approved.length ? primary : undefined}
          size="lg"
          variant="primary"
          label={`${verb} ${approved.length}`}
          isDisabled={approved.length === 0}
          isLoading={sending}
          onClick={() => {
            if (!sending) void send();
          }}
        />
      </HStack>
    </VStack>
  );
  const stepButtons = (
    <>
      <Button size="sm" variant="secondary" label="Föregående" isDisabled={step === 0} onClick={() => goTo(step - 1)} />
      <Button size="sm" variant="secondary" label="Nästa" isDisabled={last} onClick={() => goTo(step + 1)} />
    </>
  );
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      defaultHasDividers
      header={header}
      content={
        <LayoutContent>
          <VStack gap={5}>
            <VStack gap={4}>
              {/* The mark row (D71, artboard 8): the chip, the source and the counter as a neutral badge. */}
              <HStack gap={2} vAlign="center" wrap="wrap">
                <AreaChip ordinal={mark.ordinal} label={mark.title} {...(mark.icon ? { icon: mark.icon } : {})} />
                <Text type="supporting">{mark.source}</Text>
                {item && <Badge variant="neutral" label={`${step + 1} av ${items.length}`} />}
              </HStack>
              {/* The steps show the way; Ändra in the list under each row is how one goes back, so a step is never a button whose name differs from its text (2.5.3). */}
              <Stepper
                activeStep={step}
                label="Rader"
                horizontalOptions={{ minimumStepWidth: 112, collapsedVariant: 'withLabel' }}
              >
                {items.map((i, n) => (
                  <Step
                    key={i.ref}
                    step={n}
                    label={shortLabel(i)}
                    description={decisions[i.ref] ? decisionWord[decisions[i.ref]!] : undefined}
                  />
                ))}
                <Step step={items.length} label="Skicka" />
              </Stepper>
            </VStack>
            {item ? (
              <Grid columns={{ minWidth: 360, max: 2 }} gap={5}>
                {paper}
                {decision}
              </Grid>
            ) : (
              summary
            )}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          {/* On a phone the sentence goes (D73, second amendment): a touch screen has no Esc, the height is the document's,
              and the decision's own line already says that nothing is written until Skicka. */}
          <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
            {!phone && (
              <Text type="supporting">Esc sparar och stänger. Inget skrivs till {source} förrän du skickar.</Text>
            )}
            {phone ? stepButtons : <HStack gap={2}>{stepButtons}</HStack>}
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
