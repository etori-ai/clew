import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { isSnoozed, streamGroup, type Area, type AssistantStatus, type Attention, type CalendarEvent, type RhythmPoint, type SessionUser, type Thread, type TodayView, type ViewRef } from '@clew/contracts';
import { Banner, Button, ChatLayout, Divider, DropdownMenu, EmptyState, Heading, HStack, Icon, IconButton, Layout, LayoutContent, List, MoreMenu, Step, Stepper, Text, ToggleButton, ToggleButtonGroup, Toolbar, VisuallyHidden, VStack, useMediaQuery, useToast } from '@clew/ui';
import { timeLabel, today } from '@clew/calendar/dates';
import { api, ApiError } from '../api';
import { Composer } from '../components/composer';
import { ConversationContext, ConversationProvider } from '../components/conversation-context';
import { Transcript } from '../components/conversation';
import { AreasNav } from '../components/areas';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { GenericCard, ThreadRow } from '../components/card';
import { PanelView } from '../components/panel';
import { Today } from '../components/today';
import { ThreadCard } from '../components/thread';
import { Handled } from '../components/handled';
import { usePageTitle } from '../page-title';

type Pile = 'pagar' | 'inte-nu' | 'klart';
const pileHref = (p: Pile) => p === 'klart' ? '/hanterat' : `/${p}`;
const pileOf = (pathname: string): Pile | null => pathname === '/hanterat' ? 'klart' : pathname === '/pagar' ? 'pagar' : pathname === '/inte-nu' ? 'inte-nu' : null;
const pileTitle: Record<Pile, string> = { pagar: 'Pågår utan dig', 'inte-nu': 'Inte nu', klart: 'Redan hanterat' };
const greeting = (hour: number) => hour < 10 ? 'God morgon' : hour < 18 ? 'God dag' : 'God kväll';
/** The day's rhythm as words (D28): the kind of each point on the track, and what it means for the person. */
const pointName = (p: RhythmPoint, budget: number, nth: number) => p.kind === 'review' ? 'Genomgång' : p.kind === 'bundle' ? 'Samling' : p.kind === 'quiet' ? 'Tyst' : `Avbrott ${nth} av ${budget}`;
const pointDetail = (p: RhythmPoint) => p.kind === 'review' ? (p.state === 'done' ? 'allt som behöver dig' : 'nästa genomgång') : p.kind === 'bundle' ? 'resten samlas här' : p.kind === 'quiet' ? 'till 06:00' : p.title ?? '';

/**
 * Mission control (D28): the day as one track on the digest card, then Nu and Senare, notices as rows, and three piles
 * above the conversation row for what waits on others, what the person set aside and what was handled today. Areas
 * in the sidebar are lenses on the same stream. The frame is Astryx's (D31): the shell, a Layout with a bounded content
 * width and a ChatLayout that docks the row; the side panel stays live for views. Every card comes from a connector
 * through the registry; the calendar's proposal card keeps its specialised rendering, everything else is the generic card.
 */
export function StartPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  // 1.4.10: with 480 px or less in height nothing is docked; the row joins the page and the whole page scrolls (D31 item 7).
  const short = useMediaQuery(shortQuery);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [day, setDay] = useState<TodayView | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null);
  const [weeks, setWeeks] = useState<Record<string, CalendarEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  // The route is the state: /omrade/:area filters the stream, /pagar, /inte-nu and /hanterat open a pile, /vy/… the panel, /samtal/:id the row.
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ area?: string; capability?: string; threadId?: string; actionId?: string; conversationId?: string }>();
  const [search] = useSearchParams();
  const pile = pileOf(location.pathname);
  const area = params.area ?? (search.get('omrade') || null);
  const conversationId = params.conversationId ?? null;
  const pathFor = (a: string | null) => a === null ? '/' : `/omrade/${a}`;
  const back = pile ? pileHref(pile) : pathFor(area);
  const withArea = (path: string) => area ? `${path}${path.includes('?') ? '&' : '?'}omrade=${encodeURIComponent(area)}` : path;
  const viewHref = (capability: string, title: string, input?: Record<string, unknown>) => withArea(`/vy/${capability}?titel=${encodeURIComponent(title)}` + (input && Object.keys(input).length ? `&input=${encodeURIComponent(JSON.stringify(input))}` : ''));
  const cardViewHref = (threadId: string, actionId: string) => withArea(`/vy/kort/${threadId}/${actionId}`);
  const conversationHref = (id: string) => withArea(`/samtal/${id}`);
  const [view, setView] = useState<{ title: string; output: unknown } | null>(null);
  const toast = useToast();
  // A reminder that fired while the page was open (D17): the card is back in its place with a badge, and a toast says so.
  // The toast is the announcement: it animates in beside the composer and stays until dismissed; the stream never shifts.
  const remindedSeen = useRef<Map<string, string | null> | null>(null);
  const announceReminded = useCallback((list: Thread[]) => {
    const seen = remindedSeen.current;
    if (seen) for (const t of list) {
      if (t.state !== 'open' || !t.remindedAt || seen.get(t.id) === t.remindedAt) continue;
      const dismiss = toast({ body: `Påminnelse: ${t.title}`, isAutoHide: false, uniqueID: 'reminded:' + t.id,
        endContent: <Button size="sm" variant="ghost" label="Visa" onClick={() => { const shown = document.getElementById('thread-' + t.id); shown?.scrollIntoView({ behavior: 'smooth', block: 'center' }); shown?.focus({ preventScroll: true }); dismiss(); }} /> });
    }
    remindedSeen.current = new Map(list.map(t => [t.id, t.remindedAt]));
  }, [toast]);
  const load = useCallback(async () => {
    try {
      const [t, a, d, at, st] = await Promise.all([api.threads(), api.areas(), api.today().catch(() => null), api.attention(), api.assistantStatus().catch(() => null)]);
      setThreads(t.threads); setAreas(a.areas); setDay(d); setAttention(at); setAssistant(st); setError(null);
      announceReminded(t.threads);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Sidan kunde inte läsas.'); }
  }, [announceReminded]);
  useEffect(() => { void load(); }, [load]);
  // Something pushed a card while the page was open (a reminder fired): re-read the stream.
  useEffect(() => { const refresh = () => void load(); window.addEventListener('clew:refresh', refresh); return () => window.removeEventListener('clew:refresh', refresh); }, [load]);
  const loadWeek = useCallback((week: string) => {
    setWeeks(current => { if (current[week]) return current; void api.calendar(week).then(data => setWeeks(w => ({ ...w, [week]: data.events }))).catch(() => undefined); return current; });
  }, []);
  // A card that leaves the stream takes the focused button with it. Focus goes on to the next card, or the first heading when none is left (2.4.3).
  const focusAfter = useRef<{ card: string; next: string } | null>(null);
  const replace = useCallback((thread: Thread) => {
    const cards = [...document.querySelectorAll('[id^="thread-"]')].map(el => el.id);
    const at = cards.indexOf('thread-' + thread.id);
    if (at >= 0) focusAfter.current = { card: cards[at]!, next: cards[at + 1] ?? cards[at - 1] ?? 'behover-dig' };
    setThreads(list => list.some(t => t.id === thread.id) ? list.map(t => t.id === thread.id ? thread : t) : [thread, ...list]);
    void Promise.all([api.areas(), api.attention()]).then(([a, at]) => { setAreas(a.areas); setAttention(at); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (!target || document.activeElement !== document.body) return;
    // A card that moved to a pile is no longer in the stream; a card that only changed state is still here.
    const card = document.getElementById(target.card);
    const next = card?.checkVisibility() ? card : document.getElementById(target.next) ?? document.getElementById('behover-dig') ?? document.getElementById('senare');
    // A row's focus goes to its title button, the control with the ring; a card is focused as a whole, as before.
    (next?.matches('li') ? next.querySelector<HTMLElement>('button') ?? next : next)?.focus();
  }, [threads]);
  // A view is addressable (integrations.md, "Answers and views"): the panel follows /vy/:capability or /vy/kort/:thread/:action.
  const viewInput = search.get('input'), viewTitle = search.get('titel');
  useEffect(() => {
    let alive = true;
    const fail = (e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : 'Kunde inte hämta.'); };
    if (params.capability) {
      let input: unknown; try { input = viewInput ? JSON.parse(viewInput) : undefined; } catch { input = undefined; }
      api.capability(params.capability, input).then(({ output }) => { if (alive) setView({ title: viewTitle ?? params.capability!, output }); }).catch(fail);
    } else if (params.threadId && params.actionId) {
      const threadId = params.threadId, actionId = params.actionId;
      api.act(threadId, actionId).then(result => {
        if (!alive) return;
        const label = threads.find(t => t.id === threadId)?.actions.find(a => a.id === actionId)?.label ?? 'Vy';
        if (result.kind === 'execute') setView({ title: label, output: result.thread.receipt });
        else if (typeof (result.output as { url?: string }).url === 'string') window.open((result.output as { url: string }).url, '_blank', 'noopener');
        else setView({ title: label, output: result.output });
      }).catch(fail);
    } else setView(null);
    return () => { alive = false; };
  }, [params.capability, params.threadId, params.actionId, viewInput, viewTitle]);
  const openStanding = (capability: string, label: string) => navigate(viewHref(capability, label));
  const openView = (v: ViewRef) => navigate(viewHref(v.capability, v.title, v.input));
  const areaTitle = (id: string) => areas.find(a => a.id === id)?.title ?? (id === 'fragor' ? 'Fråga' : id);
  const inArea = (t: Thread) => area === null || t.area === area;
  const now = new Date().toISOString();
  const todayDate = today();
  const open = threads.filter(t => t.state === 'open' && t.kind === 'pushed');
  // Two groups and three piles (D28): what needs the person is split by today's deadline, the rest waits at the edge.
  const needsYou = open.filter(t => !t.waitingOn && !isSnoozed(t, now) && inArea(t)).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  const nu = needsYou.filter(t => streamGroup(t, todayDate) === 'nu');
  const senare = needsYou.filter(t => streamGroup(t, todayDate) === 'senare');
  const notices = needsYou.filter(t => streamGroup(t, todayDate) === 'notice');
  const waiting = open.filter(t => !!t.waitingOn && !isSnoozed(t, now));
  const snoozed = open.filter(t => isSnoozed(t, now));
  const handledToday = threads.filter(t => t.state !== 'open' && t.handledAt && t.handledAt.slice(0, 10) === now.slice(0, 10));
  const older = [...threads.filter(t => t.state === 'open' && t.kind === 'question'), ...threads.filter(t => t.state !== 'open')];
  const remaining = attention ? Math.max(0, attention.budget - attention.used) : null;
  const current = useMemo(() => areas.find(a => a.id === area) ?? null, [areas, area]);
  const pageTitle = view ? view.title : conversationId ? 'Samtal' : pile ? pileTitle[pile] : current?.title ?? (area ? null : 'Behöver dig');
  usePageTitle(pageTitle, view || conversationId ? false : pageTitle ?? false);
  const onConversation = useCallback((id: string | null) => { if (id) navigate(conversationHref(id)); else if (conversationId) navigate(back); }, [navigate, conversationId, back]);
  const row = <Composer />;

  const openCardView = (threadId: string, actionId: string) => navigate(cardViewHref(threadId, actionId));
  // Records are rows and a card is the exception (D31, Astryx structure guide): the first thread in Nu, a proposal thread, a
  // thread in a pile and every thread on a phone is a card; the rest are rows the person opens, and the opened card takes the focus.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const expandFocus = useRef<string | null>(null);
  const expand = (id: string) => { expandFocus.current = id; setOpened(s => new Set(s).add(id)); };
  // Cards sit under an h2 (Nu, Senare, Till kännedom) or under a pile's h1, so their headings are one level down (1.3.1).
  const card = (t: Thread, position?: string, headingLevel: 2 | 3 = 3) => {
    const focusTitle = expandFocus.current === t.id;
    if (focusTitle) expandFocus.current = null;
    return t.proposals.length
      ? <ThreadCard key={t.id} thread={t} events={t.week ? weeks[t.week] : undefined} compact={mobile} headingLevel={headingLevel} onChange={replace} onLoadWeek={loadWeek} />
      : <GenericCard key={t.id} thread={t} areaTitle={areaTitle(t.area)} position={position} compact={mobile} headingLevel={headingLevel} autoFocusTitle={focusTitle} onChange={replace} onOpenCardView={openCardView} />;
  };
  /** A group's threads: runs of rows in one list, a card where a thread is open. */
  const records = (list: Thread[], options: { lead?: boolean; notice?: boolean; headingLevel?: 2 | 3 } = {}) => {
    const out: React.ReactNode[] = []; let rows: React.ReactNode[] = [];
    // A run of rows is one list fenced by dividers (the structure guide: rows with dividers, no card), its text on the column's content
    // line (edge flush). A Section would bleed to the Layout's inset, which here overlaps the group heading and is clipped by the scroll container.
    const flush = () => { if (rows.length) { out.push(<VStack key={`rows-${out.length}`} gap={0}><Divider /><List hasDividers density="balanced" edge="flush">{rows}</List><Divider /></VStack>); rows = []; } };
    list.forEach((t, i) => {
      const asCard = mobile || t.proposals.length > 0 || opened.has(t.id) || (options.lead && i === 0);
      if (asCard) { flush(); out.push(card(t, options.lead ? `${i + 1} av ${list.length}` : undefined, options.headingLevel)); }
      else rows.push(<ThreadRow key={t.id} thread={t} areaTitle={areaTitle(t.area)} compact={mobile} notice={options.notice} onChange={replace} onOpenCardView={openCardView} onExpand={expand} />);
    });
    flush();
    return out;
  };
  // The piles (D28): three toggles, each a count; one opens its rows in place of the stream. They sit in the column's pinned
  // toolbar (D31 item 5): ChatLayout's frosted band is sized for one composer, so a second row on the dock would float over the cards.
  // Three toggles do not fit a phone in one row and ToggleButtonGroup never wraps; there the same choice is one menu whose rows navigate.
  const pileLabels: Record<Pile, string> = { pagar: `Pågår utan dig · ${waiting.length}`, 'inte-nu': `Inte nu · ${snoozed.length}`, klart: `Klart i dag · ${handledToday.length}` };
  const choosePile = (p: Pile | null) => navigate(p ? pileHref(p) : pathFor(area));
  const piles = mobile
    ? <HStack justify="end"><DropdownMenu presentation="adaptive" button={{ label: `Visa: ${pile ? pileLabels[pile] : 'Strömmen'}`, size: 'sm', variant: 'secondary' }} items={[
      { id: 'stream', label: 'Strömmen', onClick: () => choosePile(null) },
      ...(Object.keys(pileLabels) as Pile[]).map(p => ({ id: p, label: pileLabels[p], onClick: () => choosePile(p) })),
    ]} /></HStack>
    : <ToggleButtonGroup label="Högar" type="single" size="sm" value={pile} onChange={(v: string | null) => choosePile(v as Pile | null)}>
      {(Object.keys(pileLabels) as Pile[]).map(p => <ToggleButton key={p} value={p} label={pileLabels[p]} />)}
    </ToggleButtonGroup>;
  // The assistant's own cap on interruptions, worded as its promise: it never counts anything the person does.
  const attentionLabel = attention && (remaining === 0
    ? `Inga avbrott kvar i dag · resten samlas till ${attention.bundledUntil ?? 'i morgon 06:00'}`
    : `${remaining} avbrott kvar i dag`);
  // The digest (D28): the day as one track, and one sentence that sums the stream. Only on the whole stream, never under a lens.
  const activeStep = attention ? Math.max(0, attention.rhythm.findIndex(p => p.state === 'next')) : 0;
  const nextBundle = attention?.rhythm.find(p => p.kind === 'bundle' && p.state !== 'done');
  let interruptions = 0;
  const sentence = nu.length === 0 && waiting.length === 0 && handledToday.length === 0 ? 'Inget behöver dig just nu.'
    : `${nu.length === 0 ? 'Inget behöver dig i dag' : nu.length === 1 ? 'En sak behöver dig i dag' : `${nu.length} saker behöver dig i dag`}, ${waiting.length} pågår utan dig och ${handledToday.length} blev klara i dag.`;
  // The digest is the page's lead, not a discrete item: a section with the greeting as the h1, never a card (D31).
  const digest = attention && <VStack gap={2} as="section" aria-label="Genomgången">
      <Text type="supporting">Genomgången {attention.rhythm[0]?.at ?? '06:00'} · {open.length} trådar lästa{nextBundle ? ` · Nästa samling ${nextBundle.at}` : ''}</Text>
      <Heading level={1}>{greeting(Number(timeLabel(now).slice(0, 2)))}. {sentence}</Heading>
      <Stepper label="Dagens rytm" activeStep={activeStep} indicatorPosition="on-track" density="compact" horizontalOptions={{ minimumStepWidth: 104, collapsedVariant: 'withLabel' }}>
        {/* A step label never wraps and seven of them share the width, so the time is the label and the words go in the description, which does. */}
        {attention.rhythm.map((p, i) => <Step key={`${p.kind}-${p.at}-${i}`} step={i} label={p.at} description={`${pointName(p, attention.budget, p.kind === 'interruption' ? ++interruptions : 0)} · ${pointDetail(p)}`}
          indicator={p.kind === 'interruption' ? <Icon icon="clock" size="sm" /> : 'auto'} status={p.kind === 'interruption' ? 'error' : undefined} />)}
      </Stepper>
      <Text type="supporting">Jag stör högst {attention.budget} gånger mellan samlingarna, bara för deadline samma dag eller något du själv bad om. Allt annat samlas.</Text>
    </VStack>;

  const pileContent = pile === 'klart'
    ? <Handled threads={older} compact={mobile} onChange={replace} conversationHref={conversationHref} />
    : pile && <VStack gap={2} as="section" aria-label={pileTitle[pile]}>
      <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
        <Heading level={2} accessibilityLevel={1}>{pileTitle[pile]} · {(pile === 'pagar' ? waiting : snoozed).length}</Heading>
        <Text type="supporting">{pile === 'pagar' ? 'Kommer tillbaka av sig själva när någon svarar.' : 'Tillbaka 06:00, eller tidigare om något händer.'}</Text>
      </HStack>
      {(pile === 'pagar' ? waiting : snoozed).length === 0 && <EmptyState title="Tomt här" description={pile === 'pagar' ? 'Inget väntar på någon annan.' : 'Inget är lagt åt sidan.'} isCompact headingLevel={2} />}
      <VStack gap={2}>{(pile === 'pagar' ? waiting : snoozed).map(t => card(t, undefined, 2))}</VStack>
    </VStack>;

  /** The transcript's lead on a short screen, where there is no pinned toolbar: the title and the way out, in the flow. */
  const conversationHeader = (talk: { conversation: { title: string } | null; newConversation: () => void; close: () => void }) => <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
    <Heading level={1}>{talk.conversation?.title}</Heading>
    <HStack gap={1}><Button size="sm" variant="ghost" label="Nytt samtal" onClick={talk.newConversation} /><Button size="sm" variant="ghost" label="Stäng samtalet" onClick={talk.close} /></HStack>
  </HStack>;
  const content = <VStack gap={4}>
    {!current && !pile && !digest && <VisuallyHidden as="div"><Heading level={1}>Startsidan</Heading></VisuallyHidden>}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {pile ? pileContent : <>
      {current && <VStack gap={2} as="section" aria-label={`Området ${current.title}`}>
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading level={2} accessibilityLevel={1}>{current.title}</Heading>
          <Text type="supporting">{current.source}{current.figure ? ` · ${current.figure.label}` : ''}</Text>
        </HStack>
        {current.standing.length > 0 && <HStack gap={1} wrap="wrap" role="group" aria-label="Gör själv">
          {current.standing.map(s => <Button key={s.capability} size="sm" variant="secondary" label={s.label} clickAction={() => void openStanding(s.capability, s.label)} />)}
        </HStack>}
      </VStack>}
      {!current && digest}
      {current?.id === 'kalender' && day && <Today view={day} compact={mobile} />}
      {/* One lead per region (the h1 above), then the groups ranked by weight at one size: Heading level 3 on the page, level 2 in the outline. */}
      <VStack gap={2} as="section" aria-label="Nu">
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading id="behover-dig" tabIndex={-1} level={3} accessibilityLevel={2}>{nu.length === 0 ? 'Inget behöver dig just nu' : `Nu · ${nu.length}`}</Heading>
          <Text type="supporting">{nu.length ? 'Deadline i dag, eller något du bad om' : senare.length ? 'Resten har tid på sig' : 'Nästa genomgång i morgon 06:00'}</Text>
        </HStack>
        {needsYou.length === 0 && <EmptyState title="Lugnt läge" description="Assistenten hör av sig när något behöver dig." isCompact headingLevel={3} />}
        {nu.length > 0 && <VStack gap={2}>{records(nu, { lead: true })}</VStack>}
      </VStack>
      {senare.length > 0 && <VStack gap={2} as="section" aria-label="Senare">
        <HStack justify="between" vAlign="end" gap={2} wrap="wrap">
          <Heading id="senare" tabIndex={-1} level={3} accessibilityLevel={2}>Senare · {senare.length}</Heading>
          <Text type="supporting">Dagen står i stället för färgen</Text>
        </HStack>
        <VStack gap={2}>{records(senare)}</VStack>
      </VStack>}
      {notices.length > 0 && <VStack gap={2} as="section" aria-label="Till kännedom">
        <Heading level={3} accessibilityLevel={2}>Till kännedom · {notices.length}</Heading>
        <VStack gap={2}>{records(notices, { notice: true })}</VStack>
      </VStack>}
      {current && current.schedules.length > 0 && <VStack gap={1} as="section" aria-label="Så här bevakar jag området">
        <Heading level={3} accessibilityLevel={2}>Så här bevakar jag området</Heading>
        {current.schedules.map((s, i) => <Text key={i} type="supporting"><Text as="span" weight="semibold">{s.when}</Text> · {s.label}</Text>)}
      </VStack>}
    </>}
  </VStack>;

  return <ConversationProvider conversationId={conversationId} onConversation={onConversation} onThreadChange={replace}>
    <ConversationContext.Consumer>{talk => <Shell user={user} admin={admin} current="start" attention={attentionLabel ?? undefined} height={short ? 'auto' : 'fill'}
      sideNav={<AreasNav areas={areas} current={pile || talk.open ? undefined : area} hrefFor={pathFor} chipped={talk.chipped} />}
      /* Page level (D8): one Banner in the shell's banner slot when the model is configured but not answering. The router answers meanwhile. */
      banner={assistant && assistant.configured && !assistant.available ? <Banner status="warning" container="section" collapsible={false} title="Modellen svarar inte just nu."
        description={`Frågor besvaras av den inbyggda routern tills ${assistant.model ?? 'modellen'} svarar igen. Korten påverkas inte.`}
        endContent={<Button size="sm" variant="secondary" label="Försök igen" clickAction={() => void load()} />} /> : undefined}>
      {/* The stream is one bounded column (Layout contentWidth) with the piles pinned in its toolbar; ChatLayout docks the row at the bottom of it (D31).
          A conversation takes the column: the transcript in place of the stream, its title and its way out in the toolbar. */}
      {short
        ? <VStack gap={4} padding={3}>{talk.open ? conversationHeader(talk) : piles}{talk.open ? <Transcript onOpenView={openView} /> : content}{row}</VStack>
        : <Layout height="fill" contentWidth={960} padding={mobile ? 3 : 4} defaultHasDividers
          header={talk.open
            ? <Toolbar label="Samtalet" size="sm" startContent={<Heading level={mobile ? 3 : 1} accessibilityLevel={1}>{talk.conversation?.title}</Heading>}
              endContent={mobile
                ? <HStack gap={1} vAlign="center"><IconButton size="sm" variant="ghost" label="Stäng samtalet" icon={<Icon icon="close" />} onClick={talk.close} /><MoreMenu label="Fler val" size="sm" variant="ghost" items={[{ id: 'new', label: 'Nytt samtal', onClick: talk.newConversation }]} /></HStack>
                : <HStack gap={1} vAlign="center"><Button size="sm" variant="ghost" label="Nytt samtal" onClick={talk.newConversation} /><Button size="sm" variant="ghost" label="Stäng samtalet" icon={<Icon icon="close" size="sm" />} onClick={talk.close} /></HStack>} />
            : <Toolbar label="Högar" size="sm" startContent={piles} />}
          content={<LayoutContent isScrollable={false}>
            <VStack height="100%">
              <ChatLayout density="balanced" composer={row}>{talk.open ? <Transcript onOpenView={openView} /> : content}</ChatLayout>
            </VStack>
          </LayoutContent>} />}
    </Shell>}</ConversationContext.Consumer>
    <PanelView title={view?.title ?? null} output={view?.output} onClose={() => navigate(back)} />
  </ConversationProvider>;
}
