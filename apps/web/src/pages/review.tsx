import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Receipt, ReviewEvidence, SessionUser, Thread, ThreadAction } from '@clew/contracts';
import {
  AreaChip,
  Badge,
  Banner,
  Button,
  Card,
  CompletionFeedback,
  Divider,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  Lightbox,
  Link,
  List,
  ListItem,
  ProgressBar,
  ScrollableArea,
  Skeleton,
  Step,
  Stepper,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { ApiError, api } from '../api';
import { areasQuery, previewQuery, threadQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useMarks } from '../marks';
import { expectReceipt } from '../linger';
import { receiptComplete } from '../receipt-state';
import { insideClew, originOf, toolOf } from '../person-address';
import { itemPageHref, todoHref } from '../work-items';
import { retriedReviewHref, stepOf, withStep } from '../review-address';
import {
  approvedOf,
  clearDraft,
  leftOf,
  reviewRows,
  sameVersions,
  seenOf,
  useReviewDraft,
  useReviewShownForTheWayBack,
  withDecision,
  withoutDecision,
  type Decision,
} from '../review-session';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { reviewedAction, useCardAction } from '../components/card';
import { narrowItemQuery } from '../components/work-item';
import { DocumentReader } from '../components/document-reader';
import { ReviewRecovery } from '../components/review-recovery';

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

/** The place in the rail the review belongs to: where its work item was shown, as the item's own page marks it. */
function railOf(from: string | null): RailCurrent {
  const tool = toolOf(from);
  if (from?.startsWith('/staff')) return { surface: 'staff' };
  if (from?.startsWith('/calendar')) return { surface: 'calendar' };
  if (tool) return { surface: 'verktyg', view: tool };
  if (from === '/' || from?.startsWith('/?') || from?.startsWith('/conversations')) return { surface: 'start' };
  return { surface: 'todo' };
}

/**
 * The review of a work item's rows one at a time as a page (D70 item 2; D73, amended 2026-11-12 under the product
 * owner's rule that a task a person works through is a page with its own address): `/items/<threadId>/review`, reached
 * by "Granska N" (or "Fortsätt granska" once begun) and by a row under Dokument wherever the work item is shown, with
 * `from` the page it was shown on and `step` the step (`review-address.ts`).
 *
 * Its composition is Astryx's `form-wizard` page template with the work item page's details rail (`work-item-detail`,
 * as `WorkItemPage` composes it): the trail back, the title, the status and the progress in the pinned header (a
 * `Stepper` below five rows, a `ProgressBar` from five), the row's decision and its document in the content, "Hittills"
 * in the rail beside it (under it where the window is narrow), and the decision's buttons, then Skicka, in the pinned
 * footer. On a phone nothing is pinned above the step and the page stacks; on a short screen nothing is pinned at all.
 *
 * The decisions are the person's draft for the session (`review-session.ts`), so a reload or a way out and back finds
 * them; nothing is written until Skicka, which runs the item's own execute (D45/D47) and then leads back to the item,
 * where the row keeps its place with the receipt and Ångra (D70 item 1).
 */
export function ReviewPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const listQ = useQuery(threadsQuery);
  const listed = listQ.data?.threads.find(t => t.id === threadId);
  // Not in the stream (sent long ago): the item on its own, as its page reads it.
  const oneQ = useQuery({ ...threadQuery(threadId), enabled: !!listQ.data && !listed, retry: false });
  const live: Thread | undefined = listed ?? oneQ.data;
  const action = live ? reviewedAction(live) : undefined;
  const notFound =
    (oneQ.isError && oneQ.error instanceof ApiError && oneQ.error.status === 404) || (oneQ.isSuccess && !oneQ.data);
  const missing = (!!live && !action) || (!live && notFound);
  const failed = !live && ((listQ.isError && !listQ.data) || (oneQ.isError && !notFound));
  const origin = originOf(from, useQuery(areasQuery).data?.menu);
  const back = origin ?? { label: live?.title ?? 'Ärendet', href: from ?? itemPageHref(threadId) };
  const nav = useRail({ current: railOf(from), admin, manager: user.role === 'manager' });
  const rows = live ? reviewRows(live) : [];
  const step = live && action ? stepOf(search, rows.length + 1) : null;
  const reviewing = !!live && !!action && step !== null;
  // The review names the tab itself while it is drawn (`Review`); the page's other states name it here.
  usePageTitle(reviewing ? null : missing ? 'Ärendet finns inte' : live && action ? 'Steget finns inte' : null);
  const message = (content: ReactNode) => (
    <Layout
      height={short ? 'auto' : 'fill'}
      padding={mobile ? 3 : 8}
      content={<LayoutContent isScrollable={!short}>{content}</LayoutContent>}
    />
  );
  let body: ReactNode;
  if (reviewing) body = <Review key={threadId} live={live} action={action} step={step} from={from} back={back} />;
  else if (live && action)
    body = message(
      <EmptyState
        headingLevel={1}
        title="Steget finns inte"
        description={`Granskningen har ${rows.length + 1} steg: en rad i taget och sist Skicka.`}
        actions={
          <Button
            label="Till första steget"
            href={withStep(`/items/${encodeURIComponent(threadId)}/review`, search, 0)}
          />
        }
      />,
    );
  else if (missing)
    body = message(
      <EmptyState
        headingLevel={1}
        title="Ärendet finns inte"
        description="Det finns inget att granska här: ärendet har ingen granskning, eller så har adressen ändrats."
        actions={
          live ? <Button label="Till ärendet" href={back.href} /> : <Button label="Till Att göra" href={todoHref({})} />
        }
      />,
    );
  else if (failed)
    body = message(
      <Banner status="error" title={errorMessage(oneQ.error ?? listQ.error, 'Granskningen kunde inte läsas.')}>
        <Button
          label="Försök igen"
          size="sm"
          variant="secondary"
          onClick={() => void (listQ.isError ? listQ.refetch() : oneQ.refetch())}
        />
      </Banner>,
    );
  else body = message(<ContentSkeleton />);
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
    </Shell>
  );
}

/**
 * The review itself (D70, D73): one row at a time beside its document, then Skicka. The decisions are the draft
 * (`useReviewDraft`); the evidence of each document read (D79) is this page's alone. Nothing is written until the last
 * step's one button, which runs the same execute with the approved refs through the item's own action (`useCardAction`).
 * No text input (D12): a question about a row is asked in the conversation afterwards.
 */
function Review({
  live,
  action,
  step,
  from,
  back,
}: {
  /** The item as the cache has it now, which says when the source's answer has come to rest. */
  live: Thread;
  action: ThreadAction;
  step: number;
  from: string | null;
  back: { label: string; href: string };
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname, search } = location;
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const narrow = useMediaQuery(narrowItemQuery);
  // While the decision is on its way the item turns handled in the cache: the review keeps the item it was sending from
  // until it has led back to the item.
  const [sending, setSending] = useState(false);
  const kept = useRef<Thread>(live);
  if (!sending) kept.current = live;
  const thread = sending ? kept.current : live;
  const readOnly = submitted(thread);
  const items = reviewRows(thread);
  const item = items[step];
  const last = step >= items.length;
  const [draft, setDraft] = useReviewDraft(readOnly ? undefined : thread);
  const decisions = draft.decisions;
  // The evidence of each approval, from the read the person decided on (D79): in memory only, never kept.
  const [evidence, setEvidence] = useState<Record<string, ReviewEvidence>>({});
  const approved = approvedOf(draft, items);
  const left = leftOf(draft, items).length;
  const undecided = items.filter(i => !decisions[i.ref]).length;
  const verb = verbOf(action);
  const mark = useMarks().ofThread(thread);
  const source = thread.trigger.source;
  const title = `${readOnly ? 'Visa' : 'Granska'} ${items.length} ${items.length === 1 ? 'rad' : 'rader'}`;
  usePageTitle(title);
  // The address this review was opened at, for the control on the item that leads back to it (2.4.3).
  const [opened] = useState(() => pathname + search);
  useReviewShownForTheWayBack(thread.id, opened);
  // Back to the item: the entry before this one when the person came here by a link (Back's own way), else the item
  // where it was shown, in this entry's place.
  const navigationType = useNavigationType();
  const [byLink] = useState(() => navigationType === 'PUSH' && location.key !== 'default');
  const gone = useRef(false);
  const leave = () => {
    // Once: "Visa kvittot" and the receipt's own timer must not both step back.
    if (gone.current) return;
    gone.current = true;
    if (byLink) navigate(-1);
    else navigate(back.href, { replace: true });
  };
  const [zoom, setZoom] = useState(false);
  // A step is a place in the address, rewritten in place, so the browser's Back leaves the review (D73 item 1).
  const goTo = (n: number) => navigate(withStep(pathname, search, n), { replace: true });
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
  const onSent = () => {
    expectReceipt(thread.id);
    leave();
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
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      (
        (mobile || readOnly
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
  // landmark, and under it where the window is narrow, as a section of the column.
  const soFar = (
    <VStack gap={3} {...(narrow ? { as: 'section' as const, 'aria-labelledby': 'review-so-far' } : {})}>
      <Heading id="review-so-far" level={3} accessibilityLevel={2}>
        Hittills
      </Heading>
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
          // A native image is the one thing here Astryx has no component for: it is sized to its column and nothing more.
          <img src={dataUrl} alt={legacy!.title} style={{ display: 'block', width: '100%', height: 'auto' }} />
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
  const flowStatus = readOnly ? (
    <Badge
      variant={receiptComplete(thread.receipt) ? 'success' : 'warning'}
      icon={<Icon icon={receiptComplete(thread.receipt) ? 'check' : 'clock'} />}
      label={receiptComplete(thread.receipt) ? 'Bekräftat' : 'Behöver följas upp'}
    />
  ) : sending ? (
    <Badge variant="info" icon={<Icon icon="clock" />} label="Skickar" />
  ) : error || sendError ? (
    <Badge variant="error" icon={<Icon icon="info" />} label="Kunde inte skicka" />
  ) : undecided > 0 ? (
    <Badge variant="neutral" icon={<Icon icon="clock" />} label="Granskning pågår" />
  ) : approved.length > 0 ? (
    <Badge variant="info" icon={<Icon icon="check" />} label="Redo att skicka" />
  ) : (
    <Badge variant="neutral" icon={<Icon icon="clock" />} label="Inget att skicka" />
  );
  // The way back, the title and where the review stands, as the work item's page draws its header (`work-item-detail`).
  const trail = (
    <HStack gap={3} wrap="wrap" vAlign="center">
      <Link href={back.href} type="supporting" color="secondary">
        <HStack as="span" gap={1} vAlign="center">
          <Icon icon="chevronLeft" size="sm" />
          {back.label}
        </HStack>
      </Link>
      {!mobile && <Divider orientation="vertical" />}
      {!mobile && (
        <Text type="supporting" color="secondary">
          {[mark.source, mark.title].filter(Boolean).join(' · ')}
        </Text>
      )}
    </HStack>
  );
  const progress =
    items.length > 1 && items.length < 5 ? (
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
        <Step step={items.length} label={readOnly ? 'Resultat' : 'Skicka'} indicator="number" isDisabled={sending} />
      </Stepper>
    ) : items.length >= 5 ? (
      <ProgressBar
        label={readOnly ? 'Bekräftade rader' : 'Bedömda rader'}
        isLabelHidden
        variant="neutral"
        value={
          readOnly ? (thread.receipt?.rows.filter(r => r.outcome === 'done').length ?? 0) : items.length - undecided
        }
        max={items.length}
      />
    ) : null;
  const head = (
    <VStack gap={mobile ? 3 : 4}>
      {trail}
      <VStack gap={1}>
        <Heading level={1}>{title}</Heading>
        <Text type="supporting" color="secondary">
          {`${thread.title}\u00a0· ${readOnly ? 'resultat och underlag' : 'inget skrivs förrän du skickar'}`}
        </Text>
      </VStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {flowStatus}
        <Text type="supporting">
          {readOnly ? (thread.receipt?.rows.filter(r => r.outcome === 'done').length ?? 0) : items.length - undecided}{' '}
          av {items.length} {readOnly ? 'bekräftade' : 'bedömda'}
        </Text>
        <AreaChip ordinal={mark.ordinal} label={mark.title} {...(mark.icon ? { icon: mark.icon } : {})} />
      </HStack>
      {progress}
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
    </VStack>
  );
  const stepBody = completed ? (
    <VStack gap={3} paddingBlock={10} role="status" aria-label="Bekräftat av källan">
      <CompletionFeedback title="Klart" detail={completed.headline} />
      <Text type="supporting">Bekräftat av {source}. Kvittot finns i ärendet.</Text>
    </VStack>
  ) : item ? (
    <VStack gap={4} width="100%">
      {decision}
      {paper}
    </VStack>
  ) : (
    summary
  );
  const footer = completed ? (
    <LayoutFooter padding={mobile ? 3 : 6} hasDivider>
      <HStack>
        <Button label="Visa kvittot" onClick={onSent} />
      </HStack>
    </LayoutFooter>
  ) : readOnly ? (
    <LayoutFooter padding={mobile ? 3 : 6} hasDivider>
      <VStack gap={2}>
        {error && <Text role="alert">{error}</Text>}
        <HStack gap={2} wrap="wrap">
          <Button label="Tillbaka till ärendet" onClick={leave} />
          {['failed', 'partial'].includes(thread.execution?.state ?? '') &&
            thread.receipt?.rows.some(r => r.outcome === 'failed') && (
              <Button
                label="Granska avvisade igen"
                clickAction={() =>
                  run(async () => {
                    const next = await api.retryRejected(thread.id);
                    // The new item's review in this one's place (D80), its way back where the old item was shown.
                    navigate(retriedReviewHref(from, thread.id, next.id), { replace: true });
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
  // The column scrolls in Astryx's ScrollableArea, which takes a tab stop while it scrolls, so a step whose column
  // holds nothing focusable can still be read by keyboard; on a short screen the page scrolls as one instead (1.4.10).
  // On a phone the header scrolls with the step, so the document is not left a strip under it.
  const column = (
    <VStack gap={6}>
      {mobile && head}
      {stepBody}
      {narrow && !completed && soFar}
    </VStack>
  );
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={
        mobile ? undefined : (
          <LayoutHeader padding={6} hasDivider>
            {head}
          </LayoutHeader>
        )
      }
      content={
        short ? (
          <LayoutContent padding={mobile ? 4 : 6} isScrollable={false}>
            {column}
          </LayoutContent>
        ) : (
          <LayoutContent padding={0} isScrollable={false}>
            <ScrollableArea label="Granskningen" height="100%" padding={mobile ? 4 : 6}>
              {column}
            </ScrollableArea>
          </LayoutContent>
        )
      }
      end={
        narrow || completed ? undefined : (
          <LayoutPanel width={340} padding={6} role="complementary" label="Hittills" hasDivider isScrollable={!short}>
            {soFar}
          </LayoutPanel>
        )
      }
      footer={footer}
    />
  );
}
