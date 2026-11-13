import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARDING_EVENT_WORDS,
  BOARDING_ITEM_KINDS,
  BOARDING_ITEM_TEXT_MAX,
  BOARDING_KIND_WORDS,
  type BoardingAccess,
  type BoardingEvent,
  type BoardingItemKind,
  type BoardingItemRow,
  type BoardingOwnerRole,
  type BoardingPlanOutput,
  type SessionUser,
} from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Banner,
  Button,
  CheckboxListItem,
  ClickableCard,
  DateInput,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  HStack,
  Layout,
  LayoutContent,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  MoreMenu,
  ProgressBar,
  RadioList,
  RadioListItem,
  Selector,
  StackItem,
  StatusDot,
  Text,
  TextInput,
  VStack,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { dateLabel, displayDate, today } from '@clew/calendar/dates';
import { ApiError, api } from '../api';
import {
  BOARDING_LENS_HREF,
  boardingHref,
  personReadOf,
  planOf,
  planReadOf,
  startOf,
  withPlan,
  withStart,
  withoutStart,
} from '../boarding-address';
import {
  anchorWord,
  defaultPlan,
  distanceWords,
  hasOpen,
  itemLine,
  longDay,
  phaseWhen,
  planCounts,
  planTitle,
  shortDay,
  startWords,
  withTicked,
} from '../boarding';
import { areasQuery, boardingPersonQuery, boardingPlanQuery, entityDetailQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { useBoardingTick, useBoardingWrite } from '../mutations';
import { usePageTitle } from '../page-title';
import { pageOnly } from '../panel-address';
import { insideClew, originOf, pageSubject, personPageHref, toolOf } from '../person-address';
import { useShownForTheWayBack } from '../way-back';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { EntityPage, PageSection, RailSection, type PageSectionEntry } from '../components/entity-page';
import { DialogFrame } from '../components/dialog-frame';
import { StartPlanDialog } from '../components/boarding-start';

/**
 * One person's introduction or leaving as a page (D124, D116 rule 11: a list a person works through is a page), at
 * `/boarding/<personId>`, in the detail shape a person's page has (`EntityPage`, the `work-item-detail` template with its
 * checklist and progress): the way back (`from`), "Introduktion för <namn>" with the plan's day, its progress as Astryx's
 * `ProgressBar` and its counts in words; one section per phase with each item a row; the plan's facts, the person's other
 * plans and "Tillhör" in the rail. `?plan=` chooses one of the person's plans (the open one when it names none,
 * `boarding-address.ts`); `?start=` lays the start dialog over the page.
 *
 * Who reads what is the server's (D124 item 7): the manager the person reports to reads every item, ticks any of them,
 * adds one ("Lägg till punkt") and closes the plan ("Avsluta planen", asked in Astryx's confirmation); the person reads
 * every item and ticks their own; an owner who is neither (a buddy) is given their own items only, which the page says.
 * A tickable item is a checkbox named by its title, which ticks it at once (drawn before the server answers, put back
 * and said if it refuses), the focus staying on it and the new count said. Every kind is a plain to-do in this version:
 * no item orders or books anything (D124 item 3). With no plan, a manager is offered "Starta introduktion" and "Starta
 * avslut"; anyone else, an unknown person and a module switched off are the page's own "Planen finns inte".
 */
export function BoardingPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { personId = '' } = useParams<{ personId: string }>();
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: on a short screen nothing is pinned beside the page, and the page scrolls as one.
  const short = useMediaQuery(shortQuery);
  const announce = useAnnounce();
  const from = insideClew(search.get('from'));
  const chosen = planOf(search);
  const starting = startOf(search);
  useShownForTheWayBack(pathname + (search.toString() ? `?${search}` : ''));

  // The person's plans; refused for an item's owner who is neither the manager nor the person, who reads the plan alone.
  const personQ = useQuery(boardingPersonQuery(personId));
  const person = personQ.data;
  const planId = chosen ?? (person ? defaultPlan(person.plans)?.id : undefined);
  const planQ = useQuery({ ...boardingPlanQuery(planId ?? ''), enabled: !!planId });
  const detail = planQ.data && planQ.data.plan.personId === personId ? planQ.data : undefined;
  const panel = usePagePanel({ overlayOnly: short });
  const menu = useQuery(areasQuery).data?.menu;

  const refused = (error: unknown) => error instanceof ApiError && error.status < 500;
  const missing =
    (!!planQ.data && !detail) ||
    (planQ.isError && refused(planQ.error)) ||
    (personQ.isError && refused(personQ.error) && !chosen) ||
    (!!person && !planId && !person.canStart);
  const failed = !missing && (personQ.isError && !chosen ? personQ : planQ.isError ? planQ : null);
  const name = detail?.plan.name ?? person?.person.name ?? '';
  const userName = detail?.plan.userName ?? person?.person.userName ?? null;
  const access: BoardingAccess | undefined = detail?.plan.access;
  const title = detail ? planTitle(detail.plan.event, name) : person ? `Introduktion och avslut för ${name}` : null;
  usePageTitle(missing ? 'Planen finns inte' : title);

  // The way back (D116 rule 11): the page in `from` when Clew can name it (the person's own page by their name), else
  // where the reader works from: Personal for the manager, Att göra for an item's owner, Hem for the person.
  const fromSubject = from ? pageSubject(from.split('?')[0]!) : null;
  const back =
    fromSubject?.entity === 'person' && userName && fromSubject.key.toLowerCase() === userName.toLowerCase()
      ? { label: name, href: from! }
      : (originOf(from, menu) ??
        (from
          ? null
          : access === 'owner'
            ? { label: 'Att göra', href: '/todo' }
            : access === 'person'
              ? { label: 'Hem', href: '/' }
              : access === 'manager' || person?.canStart
                ? { label: 'Personal', href: '/staff' }
                : null));
  const tool = toolOf(from);
  const fromPath = from?.split('?')[0];
  const current: RailCurrent = fromPath?.startsWith('/staff')
    ? { surface: 'staff' }
    : fromPath === '/'
      ? { surface: 'start' }
      : fromPath === '/todo'
        ? { surface: 'todo' }
        : fromPath === '/calendar'
          ? { surface: 'calendar' }
          : tool
            ? { surface: 'verktyg', view: tool }
            : access === 'manager' || person?.canStart
              ? { surface: 'staff' }
              : access === 'owner'
                ? { surface: 'todo' }
                : { surface: 'verktyg', view: null };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });

  // The start dialog over the page (`?start=`): only for a manager, and not for an event that already has an open plan,
  // which the server would refuse. An address that asks for one anyway is let go of.
  const startable = (event: BoardingEvent) => !!person?.canStart && !hasOpen(person.plans, event);
  // Admitted once when the address asks, so the plan the dialog itself starts does not close it before it is done.
  const [admitted, setAdmitted] = useState<BoardingEvent | null>(null);
  useEffect(() => {
    if (!starting) {
      setAdmitted(null);
      return;
    }
    if (!person || admitted === starting) return;
    if (startable(starting)) setAdmitted(starting);
    else navigate(withoutStart(pathname, search), { replace: true });
  }, [starting, person]);
  const dialogEvent = starting && admitted === starting ? starting : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const startButtons = useRef(new Map<BoardingEvent, HTMLButtonElement | null>());
  const lastStart = useRef<BoardingEvent>(starting ?? 'introduction');
  if (starting) lastStart.current = starting;
  const openStart = (event: BoardingEvent) => navigate(withStart(pathname, search, event));
  /**
   * The focus after the start dialog has closed (rule 7): a plan started gives it to the page's heading, since the
   * button that opened the dialog went with the empty page; closed without starting, Astryx gives it back to what opened
   * the dialog, and where nothing did (the address opened it) the page's own way into it takes it.
   */
  const startClosed = useCallback((started: boolean) => {
    requestAnimationFrame(() => {
      if (started) {
        headingRef.current?.focus();
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const opener =
        startButtons.current.get(lastStart.current) ??
        actionsRef.current?.querySelector<HTMLElement>('button[aria-haspopup]') ??
        headingRef.current;
      opener?.focus();
    });
  }, []);

  // Ticking an item (D124 item 5: its card closes or opens with it): drawn at once, put back if the server refuses.
  const tick = useBoardingTick((plan, itemId, done) => withTicked(plan, itemId, done, today()));
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [tickError, setTickError] = useState<string | null>(null);
  const onTick = async (row: BoardingItemRow, done: boolean) => {
    if (!detail || pending.has(row.id)) return;
    const id = detail.plan.id;
    setPending(p => new Set(p).add(row.id));
    const failure = await tick(id, row.id, done, () =>
      done ? api.boarding.done(row.id) : api.boarding.notDone(row.id),
    );
    setPending(p => {
      const next = new Set(p);
      next.delete(row.id);
      return next;
    });
    if (failure) {
      setTickError(failure);
      announce(failure, 'assertive');
      return;
    }
    setTickError(null);
    const now = client.getQueryData<BoardingPlanOutput>(keys.boarding.plan(id));
    const c = planCounts(now ?? detail);
    announce(`${row.title} är ${done ? 'klar' : 'inte klar'}. ${c.done} av ${c.total} klara.`);
  };

  // "Lägg till punkt" and "Avsluta planen", the plan's manager's own.
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeWrite = useBoardingWrite({ fallback: 'Planen kunde inte avslutas.', toastId: 'boarding:close' });
  const closePlan = async () => {
    if (!detail) return;
    const ok = await closeWrite.run(() => api.boarding.close(detail.plan.id), 'Planen är avslutad.');
    if (!ok) return;
    setClosing(false);
    // The menu that held "Avsluta planen" changes with the plan: the focus goes to the page's heading (rule 7).
    requestAnimationFrame(() => requestAnimationFrame(() => headingRef.current?.focus()));
  };

  // A refusal becomes the confirmation's own text, which is not said as it changes (4.1.3): said as well.
  const closeFailure = closeWrite.error;
  useEffect(() => {
    if (closeFailure) announce(closeFailure, 'assertive');
  }, [closeFailure, announce]);

  let body: ReactNode;
  if (missing || failed || (!person && !detail) || (planId && !detail))
    body = (
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={!short}>
            {missing ? (
              <PlanMissing />
            ) : failed ? (
              <VStack gap={3}>
                <Text as="p" role="alert">
                  {errorMessage(failed.error, 'Planen kunde inte hämtas just nu.')}
                </Text>
                <HStack>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Försök igen"
                    isLoading={failed.isFetching}
                    onClick={() => void failed.refetch()}
                  />
                </HStack>
              </VStack>
            ) : (
              <ContentSkeleton />
            )}
          </LayoutContent>
        }
      />
    );
  else {
    const here = pageOnly(pathname, search);
    const plans = person?.plans ?? [];
    const manager = access === 'manager';
    const open = !!detail && detail.plan.closedAt === null;
    const startItems = (['introduction', 'leaving'] as const)
      .filter(e => startable(e))
      .map(e => ({ id: `start:${e}`, label: startWords[e].open, onClick: () => openStart(e) }));
    const menuItems = [
      ...(manager && open ? [{ id: 'close', label: 'Avsluta planen', onClick: () => setClosing(true) }] : []),
      ...(detail ? startItems : []),
    ];
    const actions =
      detail && (menuItems.length > 0 || (manager && open)) ? (
        <HStack ref={actionsRef} gap={2} vAlign="start" wrap="wrap">
          {manager && open && <Button variant="secondary" label="Lägg till punkt" onClick={() => setAdding(true)} />}
          {menuItems.length > 0 && (
            <MoreMenu
              label="Fler åtgärder"
              variant="secondary"
              alignment="end"
              presentation="adaptive"
              items={menuItems}
            />
          )}
        </HStack>
      ) : undefined;
    const c = detail ? planCounts(detail) : null;
    const meta =
      detail && c ? (
        <VStack gap={2}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            {open ? (
              <Text>{distanceWords(detail.plan.event, detail.plan.anchorOn, today())}</Text>
            ) : (
              <Badge variant="neutral" label="Avslutad" />
            )}
            {open && c.waiting > 0 && <Text>{`${c.waiting} väntar på dig`}</Text>}
            {open && c.overdue > 0 && (
              <Badge variant="warning" label={c.overdue === 1 ? '1 försenad' : `${c.overdue} försenade`} />
            )}
          </HStack>
          {c.total > 0 && (
            <HStack gap={3} vAlign="center">
              <Text hasTabularNumbers textWrap="nowrap">{`${c.done} av ${c.total} klara`}</Text>
              <StackItem size="fill">
                <ProgressBar label="Klara punkter" isLabelHidden variant="neutral" value={c.done} max={c.total} />
              </StackItem>
            </HStack>
          )}
          {access === 'owner' && (
            <Text type="supporting">
              Du ser bara dina egna punkter i planen. Resten av planen är chefens och medarbetarens.
            </Text>
          )}
        </VStack>
      ) : undefined;
    const sections: PageSectionEntry[] = detail
      ? detail.phases.map(p => ({
          key: p.phase,
          node: (
            <PageSection
              title={p.label}
              end={
                <Text type="supporting" color="secondary">
                  {phaseWhen(p.phase, detail.plan.anchorOn)}
                </Text>
              }
            >
              <List density="balanced" hasDividers edge="flush">
                {p.items.map(row => (
                  <ItemRow
                    key={row.id}
                    row={row}
                    pending={pending.has(row.id)}
                    onTick={done => void onTick(row, done)}
                  />
                ))}
              </List>
            </PageSection>
          ),
        }))
      : [];
    const empty = detail ? (
      <EmptyState
        isCompact
        headingLevel={2}
        title="Planen har inga punkter"
        description={
          manager && open
            ? 'Inget lager gällde när planen startades. Lägg till de punkter som ska göras.'
            : 'Det finns inga punkter i planen som du kan se.'
        }
      />
    ) : (
      <EmptyState
        headingLevel={2}
        title={`${name} har ingen introduktion eller något avslut`}
        description={
          person?.suggestedFirstDay
            ? `Anställningen börjar ${longDay(person.suggestedFirstDay)} enligt katalogen. Starta introduktionen så att det som ska vara klart före första dagen hinns med. Inget startar av sig självt.`
            : 'Starta en introduktion inför en första dag eller ett avslut inför en sista dag. Du väljer dagen själv, och inget startar av sig självt.'
        }
        actions={
          <HStack gap={2} wrap="wrap">
            {(['introduction', 'leaving'] as const).map((e, i) => (
              <Button
                key={e}
                ref={el => {
                  startButtons.current.set(e, el);
                }}
                variant={i === 0 ? 'primary' : 'secondary'}
                label={startWords[e].open}
                onClick={() => openStart(e)}
              />
            ))}
          </HStack>
        }
      />
    );
    const details = (
      <VStack gap={10}>
        {detail && (
          <RailSection title="Detaljer">
            <MetadataList>
              <MetadataListItem label={anchorWord[detail.plan.event]}>
                <Text>{dateLabel(detail.plan.anchorOn)}</Text>
              </MetadataListItem>
              <MetadataListItem label="Fadder">
                <Text>{detail.plan.buddy?.name ?? 'Ingen'}</Text>
              </MetadataListItem>
              <MetadataListItem label="Startad av">
                <Text>
                  {detail.plan.startedBy
                    ? detail.plan.startedBy.id === user.id
                      ? 'Du'
                      : detail.plan.startedBy.name
                    : 'Okänd'}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Startad">
                <Text>{longDay(displayDate(detail.plan.startedAt))}</Text>
              </MetadataListItem>
              {detail.plan.closedAt && (
                <MetadataListItem label="Avslutad">
                  <Text>{longDay(displayDate(detail.plan.closedAt))}</Text>
                </MetadataListItem>
              )}
            </MetadataList>
          </RailSection>
        )}
        {plans.length > 1 && (
          <RailSection title="Planer">
            <List density="compact" hasDividers edge="flush">
              {plans.map(p => (
                <ListItem
                  key={p.id}
                  href={withPlan(pathname, search, p.id)}
                  isSelected={p.id === detail?.plan.id}
                  label={<Text>{`${BOARDING_EVENT_WORDS[p.event]} ${shortDay(p.anchorOn)}`}</Text>}
                  description={
                    <Text type="supporting">{p.closedAt ? 'Avslutad' : `${p.done} av ${p.total} klara`}</Text>
                  }
                />
              ))}
            </List>
          </RailSection>
        )}
        <RailSection title="Tillhör">
          {userName ? (
            <ClickableCard label={`Person: ${name}`} href={personPageHref(userName, { from: here })} padding={3}>
              <VStack gap={0}>
                <Text type="supporting" color="secondary">
                  Person
                </Text>
                <Text weight="semibold">{name}</Text>
              </VStack>
            </ClickableCard>
          ) : (
            <VStack gap={0}>
              <Text type="supporting" color="secondary">
                Person
              </Text>
              <Text weight="semibold">{name}</Text>
            </VStack>
          )}
        </RailSection>
      </VStack>
    );
    body = (
      <EntityPage
        back={back}
        title={title ?? name}
        subtitle={detail ? `${anchorWord[detail.plan.event]} ${longDay(detail.plan.anchorOn)}` : undefined}
        actions={actions}
        meta={
          <>
            {meta}
            {tickError && <Banner status="error" title={tickError} collapsible={false} />}
          </>
        }
        sections={sections}
        empty={empty}
        details={details}
        label={title ?? name}
        panel={panel}
        headingRef={headingRef}
      />
    );
  }
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
      {panel.overlay}
      <StartPlanDialog
        event={dialogEvent}
        person={person}
        readerId={user.id}
        onClose={() => navigate(withoutStart(pathname, search))}
        onStarted={id => navigate(withPlan(pathname, search, id), { replace: true })}
        onClosed={startClosed}
      />
      {detail && access === 'manager' && detail.plan.closedAt === null && (
        <AddItemDialog plan={detail} isOpen={adding} onClose={() => setAdding(false)} />
      )}
      <AlertDialog
        isOpen={closing}
        onOpenChange={open => {
          if (!open) {
            setClosing(false);
            closeWrite.reset();
          }
        }}
        title="Avsluta planen?"
        description={`${closeWrite.error ? `${closeWrite.error} ` : ''}${CLOSE_CONSEQUENCE}`}
        actionLabel="Avsluta planen"
        cancelLabel="Avbryt"
        isActionLoading={closeWrite.busy}
        onAction={() => void closePlan()}
      />
    </Shell>
  );
}

/**
 * One item (D124 item 3: a plain to-do whatever its kind): its title, then its kind, who does it and the day it is due.
 * One the reader may tick is Astryx's checkbox row, named by its title, so it is one tab stop; one the reader may only
 * read says its state with a dot and its label. An item past its day says so with a badge, the one state that needs
 * someone.
 */
function ItemRow({
  row,
  pending,
  onTick,
}: {
  row: BoardingItemRow;
  pending: boolean;
  onTick: (done: boolean) => void;
}) {
  const late = row.status === 'Försenad' ? <Badge variant="warning" label="Försenad" /> : undefined;
  const line = <Text type="supporting">{itemLine(row)}</Text>;
  return row.canTick ? (
    <CheckboxListItem
      align="first-line"
      label={<Text>{row.title}</Text>}
      description={line}
      isChecked={row.done}
      isLoading={pending}
      onCheck={onTick}
      endContent={late}
    />
  ) : (
    <ListItem
      align="first-line"
      startContent={
        <StatusDot
          variant={row.done ? 'success' : row.status === 'Försenad' ? 'warning' : 'neutral'}
          label={row.done ? 'Klar' : 'Inte klar'}
        />
      }
      label={<Text>{row.title}</Text>}
      description={line}
      endContent={late}
    />
  );
}

/** What closing a plan does, as its confirmation says before it is done (D124 items 5 and 7). */
const CLOSE_CONSEQUENCE =
  'Planen kan inte ändras efter det, och de punkter som inte är klara försvinner från Att göra hos dem som har dem. Det som är klart står kvar.';

/** A person, a plan or a module the reader may not see: the page's own answer, the same for each (D124 item 7). */
function PlanMissing() {
  return (
    <EmptyState
      headingLevel={1}
      title="Planen finns inte"
      description="Det finns ingen sådan introduktion eller något sådant avslut som du kan se, eller så är Introduktion och avslut inte påslaget för dig. Adressen kan också ha ändrats."
      actions={<Button label="Till startsidan" href="/" />}
    />
  );
}

const OWNERS: BoardingOwnerRole[] = ['manager', 'person', 'buddy'];
/**
 * "Lägg till punkt" (D124 item 6): an item the manager adds to this plan alone, with its kind, who does it and the day
 * it is due. Its title is free text about a named person's plan: it is read on the plan by the manager, by the person
 * the plan is about (in a leaving, the one who leaves) and by the item's owner, while the card it makes in the owner's
 * Att göra says only "En uppgift i en introduktion". The field says both before it is sent. Nothing else is sent (no
 * `tiedTo`: an added item ties to nothing). A refusal is said beside the buttons, and what
 * was filled in stays; on success the dialog closes, the plan is read again and a toast says it, and Astryx gives the
 * focus back to "Lägg till punkt".
 */
function AddItemDialog({ plan, isOpen, onClose }: { plan: BoardingPlanOutput; isOpen: boolean; onClose: () => void }) {
  const mobile = useMediaQuery(mobileQuery);
  const write = useBoardingWrite({ fallback: 'Punkten kunde inte läggas till.', toastId: 'boarding:item' });
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<BoardingItemKind>('todo');
  const [owner, setOwner] = useState<BoardingOwnerRole>('manager');
  const [dueOn, setDueOn] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);
  const dueField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setKind('todo');
    setOwner('manager');
    setDueOn(undefined);
    setTried(false);
    write.reset();
    // Filled afresh each time it opens.
  }, [isOpen]);
  const text = title.trim();
  const titleProblem = !text
    ? 'Skriv vad som ska göras.'
    : [...text].length > BOARDING_ITEM_TEXT_MAX
      ? `Högst ${BOARDING_ITEM_TEXT_MAX} tecken.`
      : null;
  const dueProblem = dueOn ? null : 'Välj dagen då punkten ska vara klar.';
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  const ownerLabel: Record<BoardingOwnerRole, string> = {
    manager: 'Du',
    person: plan.plan.name,
    buddy: plan.plan.buddy ? `Faddern, ${plan.plan.buddy.name}` : 'Faddern (ingen är vald, så punkten blir din)',
  };
  const submit = async () => {
    if (write.busy) return;
    if (titleProblem || dueProblem || !dueOn) {
      setTried(true);
      (titleProblem ? titleField : dueField).current?.focus();
      return;
    }
    const ok = await write.run(
      () => api.boarding.addItem(plan.plan.id, { title: text, kind, ownerRole: owner, dueOn }),
      'Punkten är tillagd.',
    );
    if (ok) onClose();
  };
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={480}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={
          <DialogHeader
            title="Lägg till punkt"
            subtitle={planTitle(plan.plan.event, plan.plan.name)}
            onOpenChange={onOpenChange}
          />
        }
        error={write.error}
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button
              size="sm"
              variant="primary"
              label="Lägg till"
              isLoading={write.busy}
              onClick={() => void submit()}
            />
          </>
        }
      >
        <FormLayout direction="vertical" defaultOptionality="required">
          <TextInput
            ref={titleField}
            label="Punkt"
            description={`Vad som ska göras, på en rad. Texten syns här i planen för dig, för ${plan.plan.name} och för den som ska göra punkten. Uppgiften i Att göra visar den inte, bara att det är en uppgift i planen.`}
            value={title}
            onChange={setTitle}
            autoComplete="off"
            {...status(titleProblem)}
          />
          <Selector
            label="Typ"
            options={BOARDING_ITEM_KINDS.map(k => ({ value: k, label: BOARDING_KIND_WORDS[k] }))}
            value={kind}
            onChange={value => value && setKind(value as BoardingItemKind)}
            presentation="adaptive"
          />
          <RadioList label="Ansvarig" value={owner} onChange={value => setOwner(value as BoardingOwnerRole)}>
            {OWNERS.map(o => (
              <RadioListItem key={o} value={o} label={ownerLabel[o]} />
            ))}
          </RadioList>
          <DateInput
            ref={dueField}
            label="Senast"
            value={dueOn as never}
            onChange={value => setDueOn(value ?? undefined)}
            weekStartsOn="mon"
            placeholder="Välj ett datum"
            presentation="adaptive-bottom-sheet"
            {...status(dueProblem)}
          />
        </FormLayout>
      </DialogFrame>
    </Dialog>
  );
}

/** The rail and an empty page, while a read's page finds where it leads, or says it leads nowhere. */
function Redirecting({
  user,
  admin,
  missing,
  to,
}: {
  user: SessionUser;
  admin: boolean;
  missing: boolean;
  to: string | null;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const nav = useRail({ current: { surface: 'verktyg', view: null }, admin, manager: user.role === 'manager' });
  usePageTitle(missing ? 'Planen finns inte' : null);
  if (to) return <Navigate replace to={to} />;
  return (
    <Shell user={user} nav={nav}>
      <Layout
        height="fill"
        padding={mobile ? 3 : 8}
        content={<LayoutContent>{missing ? <PlanMissing /> : <ContentSkeleton />}</LayoutContent>}
      />
    </Shell>
  );
}

/**
 * The page of the read `boarding.plan` (`/tools/boarding.plan?input={"plan":…}&from=…`, D116), which an item's card in
 * its owner's Att göra leads to: the plan's page, keyed on the person, so the plan is read to learn whose it is. It
 * replaces the address, so Back from the plan returns to where the card was; the plan read here is the page's own.
 */
export function BoardingPlanReadPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { search } = useLocation();
  const { plan, from } = planReadOf(search);
  const read = useQuery({ ...boardingPlanQuery(plan ?? ''), enabled: !!plan });
  const to = read.data && plan ? boardingHref(read.data.plan.personId, { plan, from }) : null;
  return <Redirecting user={user} admin={admin} missing={!plan || read.isError} to={to} />;
}

/**
 * The page of the read `boarding.person` for one person (`/tools/boarding.person?input={"keys":[…]}`, D116), which
 * the suggestion's card "Förbered introduktionen" leads to: that person's page, where "Starta introduktion" is one press
 * away. The read names them by user name and the page by Clew's id, so the person is read to learn it. A read about more
 * than one person is a list: Personal with the lens Introduktion och avslut.
 */
export function BoardingPersonReadPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { search } = useLocation();
  const { key, from } = personReadOf(search);
  const read = useQuery({ ...entityDetailQuery('person', key ?? ''), enabled: !!key });
  const id = read.data?.entity.id;
  const to = !key ? BOARDING_LENS_HREF : id ? boardingHref(id, { from }) : null;
  return <Redirecting user={user} admin={admin} missing={read.isError || (!!read.data && !id)} to={to} />;
}
