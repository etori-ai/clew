import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, Thread, ThreadAction, ThreadItem } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Grid,
  Heading,
  HStack,
  Icon,
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
  VisuallyHidden,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { previewQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { expectReceipt } from '../linger';
import { withCard } from '../panel-address';
import { reviewHref, reviewReturn, stepOf } from '../review-address';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { reviewedAction, useCardAction } from '../components/card';

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
 * The review one row at a time as a page in the shell (D73, replacing D70 item 2's fullscreen dialog), at
 * `/cards/:threadId/review?step=`. Hem is current in the rail, since the review is a card's next step and the way back
 * leads to the card beside Hem. The card comes from the threads list, the cache the cards on Hem are drawn from (D33),
 * so a decision sent here is in Hem's threads when the page leads back. A card that is not reviewed, or a step the card
 * does not have, says so with the way home, as a tool that does not exist does (D42 item 5).
 */
export function ReviewPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'start', conversationId: null }, admin });
  const threadsQ = useQuery(threadsQuery);
  const live = threadsQ.data?.threads.find(t => t.id === threadId);
  // While the decision is on its way the card turns handled under the page: the review keeps the card it was sending
  // from until it leads back to Hem.
  const [sending, setSending] = useState(false);
  const kept = useRef<{ thread: Thread; action: ThreadAction } | null>(null);
  const action = reviewable(live);
  if (live && action) kept.current = { thread: live, action };
  const shown = live && action ? { thread: live, action } : sending ? kept.current : null;
  const rows = shown ? shown.thread.items.filter(i => i.selectable).length : 0;
  const step = shown ? stepOf(search, rows + 1) : null;
  const missing = threadsQ.data !== undefined && !shown;
  const title = missing
    ? 'Kortet finns inte'
    : shown
      ? step === null
        ? 'Steget finns inte'
        : `Granska ${rows} rader`
      : null;
  usePageTitle(title);
  const failed = threadsQ.isError && threadsQ.data === undefined;
  const padding = mobile ? 3 : 8;
  const notFound = (heading: string, description: string, actions: React.ReactNode) => (
    <Layout
      height={short ? 'auto' : 'fill'}
      padding={padding}
      content={
        <LayoutContent>
          <EmptyState headingLevel={1} title={heading} description={description} actions={actions} />
        </LayoutContent>
      }
    />
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {shown && step !== null ? (
        <Review
          thread={shown.thread}
          live={live ?? shown.thread}
          action={shown.action}
          step={step}
          sending={sending}
          onSending={setSending}
        />
      ) : shown ? (
        notFound(
          'Steget finns inte',
          `Granskningen har ${rows + 1} steg: en rad i taget och sist Skicka.`,
          <HStack gap={2} wrap="wrap">
            <Button label="Till första steget" href={reviewHref(threadId)} />
            <Button label="Till startsidan" variant="secondary" href="/" />
          </HStack>,
        )
      ) : missing ? (
        notFound(
          'Kortet finns inte',
          'Det finns inget att granska här: kortet är redan klart, har ingen granskning, eller så har adressen ändrats.',
          <Button label="Till startsidan" href="/" />,
        )
      ) : (
        <Layout
          height={short ? 'auto' : 'fill'}
          padding={padding}
          content={
            <LayoutContent>
              {failed ? (
                <Banner status="error" title={errorMessage(threadsQ.error, 'Sidan kunde inte läsas.')}>
                  <Button label="Försök igen" size="sm" variant="secondary" onClick={() => void threadsQ.refetch()} />
                </Banner>
              ) : (
                <VStack gap={3}>
                  <VisuallyHidden>Hämtar …</VisuallyHidden>
                  <Skeleton height={28} width={240} />
                  <Skeleton height={480} index={1} />
                </VStack>
              )}
            </LayoutContent>
          }
        />
      )}
    </Shell>
  );
}

/**
 * The review itself (D70 artboards B and C, D73 item 2), composed after Astryx's `form-wizard` template: the title,
 * the card's mark row and the horizontal Stepper above, one step at a time at the full content width, and Föregående and
 * Nästa in the footer; the step where the row's document stands beside its decision is the `checkout-wizard`
 * template's two columns, which stack where both do not fit. Each row gets the action's verb, Lämna kvar and Hoppa
 * över. Nothing is written until the last step's one button, which runs the same execute with the approved refs through
 * the card's own action (`useCardAction`); Spara och stäng and Esc lead back to the card with the decisions as its
 * selection. No text input (D12): a question about a row is asked in the conversation afterwards.
 */
function Review({
  thread,
  live,
  action,
  step,
  sending,
  onSending,
}: {
  thread: Thread;
  /** The thread as the cache has it now, which says when the source's answer has come to rest. */
  live: Thread;
  action: ThreadAction;
  step: number;
  sending: boolean;
  onSending: (sending: boolean) => void;
}) {
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const items = thread.items.filter(i => i.selectable);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
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
  // Leaving replaces the review's entry too: Back from the card goes where the person was before the review.
  const close = () => navigate(cardAddress(thread.id), { replace: true, state: reviewReturn(thread.id, approved) });
  const decide = (d: Decision) => {
    if (!item) return;
    setDecisions(prev => ({ ...prev, [item.ref]: d }));
    goTo(step + 1);
  };
  // Skicka is the card's own execute (D45/D47): the button keeps loading until the source's answer has come to rest,
  // and only then does the page lead back to the card, where the row keeps its place with the receipt (D70 item 1).
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
    expectReceipt(thread.id);
    navigate(cardAddress(thread.id), { replace: true });
  }, [sent, settling, error]);
  // Esc is Spara och stäng, as it was in the dialog; Esc inside a dialog (the Lightbox), a menu or a list is theirs.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.defaultPrevented ||
        document.activeElement?.closest('[role="dialog"], [role="menu"], [role="listbox"], dialog')
      )
        return;
      if (!sending) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sending]);
  // Each step opens on its one next step, so Enter takes it (artboard B); the last step on its button, or its heading when there is nothing to send.
  const primary = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => (primary.current ?? heading.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step]);
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
        <Text type="supporting" weight="semibold">
          Underlag från {source}
        </Text>
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
      <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={2}>
        {item.label}
      </Heading>
      <Text as="p" color="secondary">
        {item.detail}
      </Text>
      <HStack gap={2} wrap="wrap">
        <Button ref={primary} size="lg" variant="primary" label={verb} onClick={() => decide('approve')} />
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
        <Heading ref={heading} tabIndex={-1} level={2} accessibilityLevel={2}>
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
        <Button size="lg" variant="secondary" label="Spara och stäng" onClick={close} />
      </HStack>
    </VStack>
  );
  // The title, the card it reviews and the steps: pinned above the step where there is room for it (the template's
  // header), in the flow on a phone and on a short screen, where a pinned header would leave the document no room.
  const top = (
    <VStack gap={mobile ? 3 : 4}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <VStack gap={1}>
            <Heading level={1}>Granska {items.length} rader</Heading>
            <Text type="supporting">{thread.title} · inget skrivs förrän du skickar</Text>
          </VStack>
        </StackItem>
        <Button variant="ghost" label="Spara och stäng" onClick={close} />
      </HStack>
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
  );
  const pinned = !mobile && !short;
  const body = item ? (
    <Grid columns={{ minWidth: 360, max: 2 }} gap={5}>
      {paper}
      {decision}
    </Grid>
  ) : (
    summary
  );
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      padding={mobile ? 3 : 8}
      defaultHasDividers
      header={pinned ? <LayoutHeader hasDivider={false}>{top}</LayoutHeader> : undefined}
      content={
        <LayoutContent>
          {pinned ? (
            body
          ) : (
            <VStack gap={5}>
              {top}
              {body}
            </VStack>
          )}
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
            <Text type="supporting">Esc sparar och stänger. Inget skrivs till {source} förrän du skickar.</Text>
            <HStack gap={2}>
              <Button
                size="sm"
                variant="secondary"
                label="Föregående"
                isDisabled={step === 0}
                onClick={() => goTo(step - 1)}
              />
              <Button size="sm" variant="secondary" label="Nästa" isDisabled={last} onClick={() => goTo(step + 1)} />
            </HStack>
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
