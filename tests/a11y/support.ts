import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { MenuEntry, Thread, SiteHeaderView } from '@clew/contracts';
import {
  NEXT_WEEK,
  NOW,
  WEEK,
  areas,
  systems,
  attention,
  checkReport,
  completions,
  connectorDetail,
  connectorPreview,
  connectors,
  conversation,
  events,
  searchOutput,
  snoozePresets,
  threads,
  today,
  units,
  groups,
  user,
  siteHeader,
} from './data';
import {
  assistantStatus,
  modelDetail,
  modelProviders,
  models,
  providerDetail,
  providerReport,
  usersOverview,
  staffOverview,
  TALKS_FAIL_ERROR,
  TODAY,
  USER_NAME,
  allCommitments,
  commitmentsFor,
  myCommitments,
  readOnlyCommitments,
  readOnlyTalks,
  talkRound,
  talkRows,
  talksResult,
  type CommitmentEntry,
  type TalkEntry,
} from './data';
import type { CommitmentAddBody, CommitmentsInput, TalkHeldBody, TalkRound } from '@clew/contracts';
import type { ModelSummary, ProviderSummary } from '@clew/contracts';
import { personSearch, phonebook } from './phonebook';
import { rooms, roomsSpec } from './rooms';
import { errandsOutput, errandsSpec, smErrandOutput, smErrandSpec } from './errands';
import { manifestReference } from '../../packages/connectors/src/reference';
import { parseManifest } from '../../packages/connectors/src/remote';
import { manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { manifest as phonebookManifest } from '../../connectors/phonebook/connector.mjs';
/** The manifest reference as the server builds it (D60): the real walk over the real schema, so the page is tested on what it will draw. */
export const reference = manifestReference([
  parseManifest(phonebookManifest, 'phonebook'),
  parseManifest(helloManifest, 'hello'),
]);

export const desktop = { width: 1280, height: 800 };
export const phone = { width: 375, height: 667 };
/** 1.4.10: 320 CSS px wide and 256 high are the two reflow limits; 256 is a landscape phone or 400 % zoom. */
export const narrow = { width: 320, height: 640 };
export const short = { width: 320, height: 256 };

const session = { csrfToken: 'test', sessionKey: 'test', expiresAt: '2026-11-04T16:00:00.000Z', user };
import type { ConnectorSummary } from '@clew/contracts';

/** The API as the browser sees it, held in memory per test. `/api/**` never leaves the page. */
export class MockApi {
  threads = threads();
  /** The areas and the systems behind them with their marks' ordinals (D71); a test may add a system's area. */
  areas = [...areas];
  systems = [...systems];
  deliveries: Array<{ id: string; threadId: string; kind: 'automatic' | 'reminder' }> = [];
  deliveryClaims: string[] = [];
  sources: Array<{ connector: string; state: string; lastSuccess: string | null; error: string | null }> = [];

  answerDelay = 0;
  private answerHeld?: Promise<void>;
  /** Every question the box sent, as it was sent: the text, the conversation it continues, and what went along as chips. */
  asked: { text: string; conversationId?: string; chips?: { ref: string }[] }[] = [];
  /** How long the first read of the cards takes, so a test can see the page while they load (D36). */
  threadsDelay = 0;
  /** How long the areas take, so a test can see Läget's tiles in their shape (D54). */
  areasDelay = 0;
  /** How long Avfärda, Inte nu and Ta upp nu take to answer, and whether the server refuses, so a test can see the card as the person's action leaves it (D64). */
  mutationDelay = 0;
  mutationFails = false;
  sessionDelay = 0;
  signedIn = true;
  /** The session says the person may administer connectors (D23). Off by default so the other suites see the ordinary page. */
  admin = false;
  /** Användare (D85): the people and the group-capability rows the users page shows; the rows change with the page's actions. */
  users = usersOverview();
  /** The users page for someone with `admin.connectors` but not `admin.users`: the server refuses. */
  usersForbidden = false;
  /** Personal (D94): the units the test person manages and their people. */
  staff = staffOverview();
  /** Personal for someone who manages no unit: the server refuses whatever the session's role says. */
  staffForbidden = false;
  /**
   * The session person is an employee who manages nobody: the session's role is `employee`, Personal is refused, the
   * round lists nobody and their own action points are only the ones about them. For Hem without Personal.
   */
  employee = false;
  /** Utvecklingssamtal (D96). False: the person has no talks system, so both reads are refused as the registry refuses them. */
  talksOffered = true;
  /** False: another system answers the profile; the reads are read-only (no `id`, a `link` on every row) and the writes refused. */
  talksWritable = true;
  /** The open round; null for none (the round then lists nobody). */
  talksRound: TalkRound | null = talkRound();
  /** The calendar did not answer: booked rows read as missing and the answer says `bookedUnknown`. */
  talksBookedUnknown = false;
  /** The next talk write answers 400 with `TALKS_FAIL_ERROR`; it resets itself after that one. */
  talksFail = false;
  /** The round's rows and every action point, as the writes leave them. A test may replace either. */
  talkRows: Array<Omit<TalkEntry, 'openCommitments'>> = talkRows();
  commitments: CommitmentEntry[] = allCommitments();
  /** Every talk write that reached the mock, in order. */
  talkWrites: Array<{ method: string; path: string; body: unknown }> = [];
  private heldBefore = new Map<string, Omit<TalkEntry, 'openCommitments'>>();
  private nextCommitment = 1;
  /** The shared header (D88) every page draws: Clew's default until a test gives the person a connector's header. */
  header: SiteHeaderView = siteHeader();
  connectors: ConnectorSummary[] = connectors();
  /** The rows under Verktyg in the menu (D40): none until a test puts one there, as none is shown until an administrator switches one on. */
  menu: MenuEntry[] = [];
  /** The views an administrator has put in the menu on the admin pages, by capability name. */
  menuOn: string[] = [];
  /** The areas whose figure an administrator switched off on the admin pages (D54), by area id. */
  figuresOff: string[] = [];
  /** Modeller (D24): the providers and models the admin pages show, and how many models the person may pick in the box (two shows the menu). */
  providers: ProviderSummary[] = modelProviders();
  models: ModelSummary[] = models();
  modelChoices = 1;
  currentModel = 'gpt-oss-120b';
  output: unknown = {
    date: '2026-11-04',
    onDuty: ['Anna Lindqvist 07:00–16:00'],
    absent: [{ name: 'Sara Nyström', kind: 'short' }],
  };
  unmocked: string[] = [];
  /** Keeps every turn pending until the returned function is called, for a test that works while the answer is on its way: `answerDelay` can run out first on a slow machine. */
  holdAnswer() {
    let release = () => {};
    this.answerHeld = new Promise<void>(resolve => {
      release = resolve;
    });
    return release;
  }
  private update(id: string, change: Partial<Thread>) {
    this.threads = this.threads.map(t => (t.id === id ? { ...t, ...change, updatedAt: NOW } : t));
    return this.threads.find(t => t.id === id)!;
  }
  async handle(route: Route) {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api', ''),
      post = request.method() === 'POST';
    const json = (body: unknown) => route.fulfill({ json: body });
    const id = path.split('/')[2] ?? '';
    if (path === '/protocol/manifest-reference.json') return json(reference);
    if (path === '/changes')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    if (path === `/threads/${id}/execution/check`) return json(this.threads.find(t => t.id === id));
    if (path === '/auth/session') {
      if (this.sessionDelay) await new Promise(resolve => setTimeout(resolve, this.sessionDelay));
      return this.signedIn
        ? json({ ...session, ...(this.employee ? { user: { ...user, role: 'employee' } } : {}), admin: this.admin })
        : route.fulfill({ status: 401, json: { error: 'Ingen session' } });
    }
    if (path === '/auth/activity') return json({ expiresAt: session.expiresAt });
    // The shared header (D88): what the person's header connector lists for them, Clew's default until a test says otherwise.
    if (path === '/header') return json(this.header);
    // The MCP service inbox (D81): empty unless a spec routes it itself.
    if (path === '/chat-services') return json({ services: [], deliveries: [] });
    // Personal (D94): the manager's units and their people, or the server's refusal.
    if (path === '/staff')
      return this.staffForbidden || this.employee
        ? route.fulfill({
            status: 403,
            json: { error: 'Sidan Personal är för den som är chef för en enhet.', code: 'denied' },
          })
        : json(this.staff);
    if (path.startsWith('/admin/')) {
      if (!this.admin)
        return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
      const method = request.method();
      const cid = path.split('/')[3] ?? '';
      const found = () => this.connectors.find(c => c.id === cid);
      if (path === '/admin/units') return json({ units });
      if (path === '/admin/groups') return json({ groups });
      if (path === '/admin/users' && method === 'GET')
        return this.usersForbidden
          ? route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } })
          : json(this.users);
      if (path === '/admin/users/group-capabilities' && method === 'POST') {
        const input = request.postDataJSON() as {
          groupExternalId: string;
          capability: 'admin.connectors' | 'admin.users';
        };
        if (
          !this.users.groupCapabilities.some(
            m => m.groupExternalId === input.groupExternalId && m.capability === input.capability,
          )
        )
          this.users.groupCapabilities.push({
            groupExternalId: input.groupExternalId,
            groupLabel: this.users.groups.find(g => g.id === input.groupExternalId)?.label ?? null,
            capability: input.capability,
          });
        return json(this.users);
      }
      if (path === '/admin/users/group-capabilities/remove' && method === 'POST') {
        const input = request.postDataJSON() as { groupExternalId: string; capability: string };
        this.users.groupCapabilities = this.users.groupCapabilities.filter(
          m => !(m.groupExternalId === input.groupExternalId && m.capability === input.capability),
        );
        return json(this.users);
      }
      if (path.startsWith('/admin/models') || path.startsWith('/admin/providers'))
        return this.handleModels(route, method, path);
      if (path === '/admin/connectors' && method === 'GET') return json({ connectors: this.connectors });
      if (path === '/admin/connectors' && method === 'POST') {
        const input = request.postDataJSON() as { id: string; url: string };
        const c: ConnectorSummary = {
          ...connectorDetail({
            ...this.connectors[2]!,
            id: input.id,
            source: 'Nytt system',
            url: input.url,
            state: 'draft',
            registered: false,
            health: { status: 'ok', at: NOW },
          }),
        };
        this.connectors = [...this.connectors, c];
        return route.fulfill({
          status: 201,
          json: {
            connector: connectorDetail(c),
            report: { ok: true, items: checkReport.items.filter(i => i.level === 'ok') },
          },
        });
      }
      if (path === `/admin/connectors/${cid}/test`)
        return json({ ...checkReport, health: { status: 'secret-rejected', at: NOW } });
      if (path === `/admin/connectors/${cid}/refresh`) {
        const c = found();
        return c
          ? json({
              diff: {
                added: ['hello.remind'],
                removed: ['hello.openItems'],
                changed: [],
                areasAdded: [],
                areasRemoved: [],
                same: false,
              },
              connector: connectorDetail(c),
            })
          : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
      }
      if (path === `/admin/connectors/${cid}/preview`)
        return json(connectorPreview(url.searchParams.get('role') === 'employee' ? 'employee' : 'manager'));
      if (path === `/admin/connectors/${cid}/secret`) {
        const c = found();
        return c
          ? json(connectorDetail({ ...c, secretChangedAt: NOW }))
          : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
      }
      if (path === `/admin/connectors/${cid}`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        if (method === 'DELETE') {
          this.connectors = this.connectors.filter(x => x.id !== cid);
          return json({ closedCards: 1 });
        }
        if (method === 'PATCH') {
          const patch = request.postDataJSON() as Partial<ConnectorSummary>;
          const next = {
            ...c,
            ...('state' in patch ? { state: patch.state! } : {}),
            ...('audience' in patch ? { audience: patch.audience! } : {}),
            ...('scanEnabled' in patch ? { scanEnabled: patch.scanEnabled! } : {}),
            ...('toolsEnabled' in patch ? { toolsEnabled: patch.toolsEnabled! } : {}),
            ...('header' in patch ? { header: patch.header! } : {}),
            updatedAt: NOW,
          };
          // The header is exclusive (D88): the new holder takes it from the previous one.
          if ('header' in patch && patch.header)
            this.connectors = this.connectors.map(x => (x.id === cid ? x : { ...x, header: false }));
          if ('menu' in patch)
            for (const [name, on] of Object.entries((patch as { menu: Record<string, boolean> }).menu))
              this.menuOn = on ? [...new Set([...this.menuOn, name])] : this.menuOn.filter(n => n !== name);
          if ('figures' in patch)
            for (const [area, on] of Object.entries((patch as { figures: Record<string, boolean> }).figures))
              this.figuresOff = on ? this.figuresOff.filter(a => a !== area) : [...new Set([...this.figuresOff, area])];
          this.connectors = this.connectors.map(x => (x.id === cid ? next : x));
          return json(connectorDetail(next, this.menuOn, this.figuresOff));
        }
        return json(connectorDetail(c, this.menuOn, this.figuresOff));
      }
    }
    if (path === '/threads') {
      if (this.threadsDelay) await new Promise(resolve => setTimeout(resolve, this.threadsDelay));
      return json({ threads: this.threads, deliveries: this.deliveries, sources: this.sources });
    }
    if (path.startsWith('/deliveries/') && path.endsWith('/claim') && post) {
      const deliveryId = decodeURIComponent(path.split('/')[2]!);
      const claimed = !this.deliveryClaims.includes(deliveryId);
      if (claimed) this.deliveryClaims.push(deliveryId);
      return json({ claimed });
    }
    if (path === '/areas') {
      if (this.areasDelay) await new Promise(resolve => setTimeout(resolve, this.areasDelay));
      return json({ areas: this.areas, menu: this.menu, systems: this.systems });
    }
    if (path === '/today') return json(today);
    if (path === '/attention') return json(attention);
    if (path === '/completions') return json(completions);
    if (path === '/assistant/status') return json(assistantStatus(this.modelChoices, this.currentModel));
    if (path === '/assistant/model' && request.method() === 'PATCH') {
      this.currentModel = (request.postDataJSON() as { modelId: string }).modelId;
      return json(assistantStatus(this.modelChoices, this.currentModel));
    }
    if (path === '/calendar') {
      const from = url.searchParams.get('from') ?? '2026-11-02';
      return json({
        from,
        events: events(from),
        proposals: from === NEXT_WEEK ? (this.threads.find(t => t.id === 'samtal')?.proposals ?? []) : [],
      });
    }
    // A person's own bookings and proposal moves (D32): the form's lists, the free-busy check, and the writes answered as the server would.
    if (path === '/calendar/members')
      return json({
        members: [
          { name: 'Anna Lindqvist', email: 'anna@clew.test' },
          { name: 'Erik Sandström', email: 'erik@clew.test' },
        ],
      });
    if (path === '/calendar/rooms')
      return json({ rooms: [{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: ['skärm'] }] });
    if (path === '/calendar/availability' && post)
      return json({
        mine: 'free',
        participants: [{ email: 'anna@clew.test', name: 'Anna Lindqvist', state: 'busy' }],
        room: { ref: 'room:a12', name: 'A12', state: 'free' },
      });
    if (['/calendar/events', '/calendar/events/reschedule', '/calendar/events/cancel'].includes(path) && post) {
      const b = request.postDataJSON() as { decisionId: string; title?: string };
      const card: Thread = {
        ...this.threads[0]!,
        id: 'calendar:' + b.decisionId,
        topic: 'calendar:' + b.decisionId,
        connector: 'calendar',
        area: 'calendar',
        title: b.title ?? 'Kalenderändring',
        summary: 'Beslutet är sparat.',
        state: 'open',
        items: [],
        actions: [],
        proposals: [],
        receipt: null,
        waitingOn: 'Väntar på kalenderns besked',
        execution: {
          id: b.decisionId,
          decisionId: b.decisionId,
          operation: 'calendar.createEvent',
          state: 'pending',
          reason: null,
          compensates: null,
        },
      };
      this.threads.push(card);
      return route.fulfill({ status: 202, json: card });
    }
    if (/^\/threads\/[^/]+\/proposals\/[^/]+\/move$/.test(path) && post) {
      const b = request.postDataJSON() as { start: string; end: string };
      const pid = path.split('/')[4];
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, { proposals: t.proposals.map(p => (p.id === pid ? { ...p, start: b.start, end: b.end } : p)) }),
      );
    }
    if (path === '/cap/calendar.today') return json({ output: today });
    if (path === '/cap/calendar.week') {
      const from = (JSON.parse(url.searchParams.get('input') ?? '{}') as { from?: string }).from ?? '2026-11-02';
      return json({ output: { from, events: events(from) } });
    }
    if (path === '/cap/calendar.day') {
      const date = (JSON.parse(url.searchParams.get('input') ?? '{}') as { date?: string }).date ?? '2026-11-04';
      return json({
        output: { from: date, events: events(date).filter(e => e.start.startsWith(date)), proposals: [] },
      });
    }
    // The calendar's rooms (D69, amended): the one calendar read with a declared view, drawn by the one renderer.
    if (path === '/cap/calendar.rooms') return json({ output: { rows: rooms }, source: 'Kalendern', view: roomsSpec });
    // No MCP service is registered for the person here (D81); mcp.spec.ts routes its own answers over this one.
    if (path === '/chat-services') return json({ services: [], deliveries: [] });
    // The combined errand list (D35 item 4, D89) and one errand in the system a row came from.
    if (path === '/cap/clew.errands') return json({ output: errandsOutput, source: 'Startsidan', view: errandsSpec });
    if (path === '/cap/sm.errand')
      return json({ output: smErrandOutput, source: 'Ärendesystemet', view: smErrandSpec });
    // Utvecklingssamtal (D96): the two composites and the built-in module's writes.
    if (path === '/cap/clew.talks' || path === '/cap/clew.commitments' || path.startsWith('/talks/'))
      return this.handleTalks(route, path, url);
    // `@` as the server answers it: with nothing typed only the context the box sends (`near`), with text everything open, the context first.
    if (path === '/objects') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase(),
        near = (url.searchParams.get('near') ?? '').split(',');
      const all = this.threads
        .filter(t => t.state === 'open' && t.kind === 'pushed')
        .flatMap(t => [
          {
            ref: 'thread:' + t.id,
            kind: 'thread',
            label: t.title,
            detail: 'kort',
            threadId: t.id,
            visible: near.includes('thread:' + t.id),
          },
          ...t.items.map(i => ({
            ref: i.ref,
            kind: 'item',
            label: i.label,
            detail: 'rad',
            threadId: t.id,
            visible: near.includes('thread:' + t.id),
          })),
        ]);
      const hits = q ? all.filter(o => o.label.toLowerCase().includes(q)) : all.filter(o => o.visible);
      return json({ objects: [...hits.filter(o => o.visible), ...hits.filter(o => !o.visible)].slice(0, 12) });
    }
    // A name finds a person (D38): the hit carries its contact card as a view. Anything else finds the routine.
    if (path === '/cap/clew.search')
      return json({ output: /lindqvist/i.test(url.searchParams.get('input') ?? '') ? personSearch : searchOutput });
    // The phone book's declared views, answered by the connector itself.
    if (path.startsWith('/cap/phonebook.')) {
      const answer = await phonebook(path.slice('/cap/'.length), JSON.parse(url.searchParams.get('input') ?? '{}'));
      return route.fulfill({ status: answer.status, json: answer.body });
    }
    if (path === '/cap/clew.cardFromAnswer' && post) return json({ output: { threadId: 'rutin' } });
    if (path.startsWith('/cap/')) return json({ output: this.output, source: 'Personalsystemet' });
    // A turn as the server streams it (D36): a read as a step, the answer in two deltas, then the finished turn. Playwright
    // answers in one piece, so the pending turn is what `answerDelay` and `holdAnswer` hold open.
    if (path === '/conversation/stream') {
      const body = request.postDataJSON() as { text: string; conversationId?: string; chips?: { ref: string }[] };
      this.asked.push(body);
      await this.answerHeld;
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      const step = { id: 'steg-1', capability: 'mock.read', title: 'Läser', source: response.answer.source };
      const half = Math.ceil(response.answer.body.length / 2);
      const events = [
        { type: 'step', step: { ...step, status: 'running' } },
        { type: 'step', step: { ...step, status: 'complete', ms: 800 } },
        { type: 'text', delta: response.answer.body.slice(0, half) },
        { type: 'text', delta: response.answer.body.slice(half) },
        { type: 'done', response },
      ];
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
        });
      } catch {
        return;
      }
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return;
    }
    if (path === '/conversation') {
      const body = request.postDataJSON() as { text: string; conversationId?: string };
      await this.answerHeld;
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return json(response);
    }
    if (path.endsWith('/verbs')) return json({ verbs: [] });
    if (path === '/snooze/presets') return json({ presets: snoozePresets });
    if (post && /^\/threads\/[^/]+\/(dismiss|snooze|reopen)$/.test(path)) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
    }
    if (path.endsWith('/snooze') && post) {
      const body = (request.postDataJSON() ?? {}) as { preset?: string; until?: string; text?: string };
      const until = body.until ?? snoozePresets.find(p => p.id === body.preset)?.at ?? '2026-11-05T05:00:00.000Z';
      return json(this.update(id, { snoozedUntil: until }));
    }
    if (path.endsWith('/dismiss') && post) return json(this.update(id, { state: 'dismissed', handledAt: NOW }));
    if (path.endsWith('/remind-invitees') && post) {
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, {
          proposals: t.proposals.map(p =>
            p.status === 'confirmed' ? { ...p, reminders: p.reminders + 1, remindedAt: NOW } : p,
          ),
        }),
      );
    }
    if (path.endsWith('/reopen') && post)
      return json(this.update(id, { state: 'open', handledAt: null, snoozedUntil: null }));
    // Confirming proposals (D70 amended): the calendar reads the invitations back, the card stays open and waits on the
    // invitees, and its receipt carries the way back for ten minutes.
    if (path.endsWith('/confirm') && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      const body = (request.postDataJSON() ?? {}) as { proposalIds?: string[] };
      const t = this.threads.find(t => t.id === id)!;
      const ids = body.proposalIds ?? [];
      const sent = t.proposals.filter(p => ids.includes(p.id));
      return json(
        this.update(id, {
          waitingOn: 'svar från medarbetarna',
          proposals: t.proposals.map(p =>
            ids.includes(p.id)
              ? { ...p, status: 'confirmed', eventRef: `memory:${p.id}`, undoUntil: '2026-11-04T08:10:00.000Z' }
              : p,
          ),
          receipt: {
            at: NOW,
            headline: `${sent.length} av ${sent.length} kalenderändringar är bekräftade.`,
            undoUntil: '2026-11-04T08:10:00.000Z',
            undoCapability: 'calendar.undoProposals',
            rows: sent.map(p => ({
              ref: p.id,
              label: p.participant.name,
              outcome: 'done',
              detail: 'Kontrollerat i kalendern.',
            })),
          },
        }),
      );
    }
    // The receipt's way back (D70): the card is as it was before the decision, its proposals proposed again.
    if (path.endsWith('/undo-receipt') && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, {
          state: 'open',
          handledAt: null,
          waitingOn: null,
          receipt: null,
          proposals: t.proposals.map(p =>
            p.status === 'confirmed' ? { ...p, status: 'proposed', eventRef: null, undoUntil: null } : p,
          ),
        }),
      );
    }
    // One item's document for the review flow (D70): an SVG the way the finance fixture draws one.
    if (path.endsWith('/preview') && !post) {
      const ref = url.searchParams.get('ref') ?? '';
      const item = this.threads.find(t => t.id === id)?.items.find(i => i.ref === ref);
      if (!item) return route.fulfill({ status: 400, json: { error: 'Raden finns inte på kortet.' } });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" role="img" aria-label="${item.label}"><rect width="640" height="400" fill="#fff"/><text x="48" y="64" font-size="22" font-weight="700">${item.label}</text><text x="48" y="120" font-size="14">${item.detail}</text></svg>`;
      return json({
        title: `Faktura · ${item.label}`,
        mediaType: 'image/svg+xml',
        data: Buffer.from(svg).toString('base64'),
      });
    }
    if (path.endsWith('/act') && post) {
      // An execute answers with the card as the source read it back (D70): here at once, with the refs the person approved.
      const body = (request.postDataJSON() ?? {}) as { actionId?: string; refs?: string[] };
      const t = this.threads.find(t => t.id === id);
      const action = t?.actions.find(a => a.id === body.actionId);
      if (t && action?.kind === 'execute') {
        if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
        if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
        const refs = body.refs ?? t.items.filter(i => i.selected).map(i => i.ref);
        const receipt: Thread['receipt'] = {
          at: NOW,
          headline: `${refs.length} ${refs.length === 1 ? 'faktura attesterad' : 'fakturor attesterade'}`,
          undoUntil: '2026-11-04T08:10:00.000Z',
          undoCapability: 'finance.unapprove',
          rows: refs.map(ref => ({
            ref,
            label: t.items.find(i => i.ref === ref)?.label ?? ref,
            outcome: 'done',
            detail: 'Läst tillbaka från ekonomisystemet',
          })),
        };
        return json({ kind: 'execute', thread: this.update(id, { state: 'handled', handledAt: NOW, receipt }) });
      }
      return json({ kind: 'read', output: this.output });
    }
    if (path.startsWith('/threads/') && !post) return json(this.threads.find(t => t.id === id));
    this.unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: 'Inte mockat' } });
  }
  /**
   * Utvecklingssamtal (D96), answered as the server would: the reads through the capability route (refused for a person
   * without a talks system, read-only when another system answers), and the five writes over the mock's own state, so a
   * spec sees the lists change on the next read.
   */
  private handleTalks(route: Route, path: string, url: URL) {
    const request = route.request(),
      method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const fail = (status: number, error: string) => route.fulfill({ status, json: { error } });
    const empty = () => route.fulfill({ status: 204, body: '' });
    // The registry's own refusal for a capability outside the person's scope: a 400 with its sentence and no code.
    if (!this.talksOffered) return fail(path.startsWith('/cap/') ? 400 : 403, 'Du saknar behörighet för åtgärden.');
    if (path === '/cap/clew.talks') {
      const result = talksResult({
        round: this.talksRound,
        rows: this.employee ? [] : this.talkRows,
        commitments: this.commitments,
        bookedUnknown: this.talksBookedUnknown,
      });
      return json({ output: this.talksWritable ? result : readOnlyTalks(result), source: result.source });
    }
    if (path === '/cap/clew.commitments') {
      const input = JSON.parse(url.searchParams.get('input') ?? '{}') as CommitmentsInput;
      // `person` is a user name (or an id for someone without one); an employee reads nobody's but their own.
      const about =
        this.staff.units.flatMap(u => u.people).find(p => (p.userName ?? p.id) === input.person)?.id ??
        (input.person === USER_NAME ? user.id : null);
      const result =
        input.person === undefined
          ? myCommitments(this.commitments, this.employee)
          : commitmentsFor(about && (!this.employee || about === user.id) ? about : '', this.commitments);
      return json({ output: this.talksWritable ? result : readOnlyCommitments(result), source: result.source });
    }
    const body = method === 'POST' ? (request.postDataJSON() ?? {}) : null;
    this.talkWrites.push({ method, path, body });
    if (!this.talksWritable) return fail(403, 'Du saknar behörighet för åtgärden.');
    const done = /^\/talks\/commitments\/([^/]+)\/done$/.exec(path);
    // The owner of an action point marks it done and opens it again whatever their role (D96 item 4); someone who
    // manages nobody may do nothing else here.
    if (this.employee && !done) return fail(403, 'Du saknar behörighet för åtgärden.');
    if (this.talksFail) {
      this.talksFail = false;
      return fail(400, TALKS_FAIL_ERROR);
    }
    if (done) {
      const id = decodeURIComponent(done[1]!);
      const row = this.commitments.find(c => c.id === id);
      if (!row) return fail(400, 'Åtgärdspunkten finns inte.');
      if (!row.mine) return fail(403, 'Bara den som äger åtgärdspunkten kan markera den som klar.');
      this.commitments = this.commitments.map(c => {
        if (c.id !== id) return c;
        if (method === 'POST') return { ...c, done: true, doneAt: NOW };
        const { doneAt: _doneAt, ...open } = c;
        return { ...open, done: false };
      });
      return empty();
    }
    const [, , personId = '', what] = path.split('/').map(decodeURIComponent);
    const row = this.talkRows.find(r => r.personId === personId);
    if (what === 'held') {
      if (!row) return fail(400, 'Personen finns inte i samtalsomgången.');
      if (method === 'POST') {
        const heldOn = (body as TalkHeldBody).heldOn ?? TODAY;
        if (row.state !== 'held') this.heldBefore.set(personId, row);
        this.talkRows = this.talkRows.map(r => (r.personId === personId ? { ...r, state: 'held', at: heldOn } : r));
        return json({ id: `held-${personId}`, heldOn });
      }
      if (row.state !== 'held') return fail(400, 'Samtalet är inte markerat som hållet.');
      const { at: _at, ...missing } = row;
      const before = this.heldBefore.get(personId) ?? { ...missing, state: 'missing' as const };
      this.heldBefore.delete(personId);
      this.talkRows = this.talkRows.map(r => (r.personId === personId ? before : r));
      return empty();
    }
    if (what === 'commitments' && method === 'POST') {
      const staff = this.staff.units.flatMap(u => u.people).find(p => p.id === personId);
      if (!staff) return fail(400, 'Personen finns inte på dina enheter.');
      const input = body as Partial<CommitmentAddBody>;
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return fail(400, 'Skriv vad åtgärdspunkten gäller.');
      if (
        text.length > 280 ||
        !['employee', 'manager'].includes(input.owner ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn ?? '')
      )
        return fail(400, 'Ogiltig förfrågan.');
      const id = `c-new-${this.nextCommitment++}`;
      this.commitments = [
        ...this.commitments,
        {
          id,
          ref: `commitment:talks:${id}`,
          personId,
          userName: staff.userName ?? staff.id,
          name: staff.name,
          owner: input.owner!,
          mine: input.owner === 'manager',
          text,
          dueOn: input.dueOn!,
          done: false,
          carried: false,
        },
      ];
      return json({ id }, 201);
    }
    this.unmocked.push(`${method} ${path}`);
    return fail(500, 'Inte mockat');
  }
  /** Modeller (D24), answered as the server would: the list, one model or provider, the writes, and a test that lists three models. */
  private handleModels(route: Route, method: string, path: string) {
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const missing = (what: string) => route.fulfill({ status: 400, json: { error: `${what} finns inte.` } });
    const [, , kind, id = '', action] = path.split('/');
    const body = () => (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const counted = () => {
      this.providers = this.providers.map(p => ({
        ...p,
        models: this.models.filter(m => m.providerId === p.id).length,
        enabledModels: this.models.filter(m => m.providerId === p.id && m.state === 'enabled').length,
      }));
    };
    // A model whose id starts with "trasig" plays one the provider refuses, so a failed test on add can be heard.
    const answered = (m: ModelSummary) =>
      m.model.startsWith('trasig')
        ? {
            ok: false,
            models: [],
            health: { status: 'ok', at: NOW },
            findings: [{ level: 'fail', text: 'Leverantören svarar men vägrar anropet.' }],
          }
        : {
            ok: true,
            models: [],
            health: { status: 'ok', at: NOW },
            findings: [{ level: 'ok', text: `${m.title} svarar.` }],
          };
    if (kind === 'models') {
      if (!id && method === 'GET') return json({ providers: this.providers, models: this.models });
      if (!id && method === 'POST') {
        const input = body() as { providerId: string; model: string; title?: string; description?: string };
        const p = this.providers.find(x => x.id === input.providerId)!;
        const m: ModelSummary = {
          ...this.models[0]!,
          id: input.model.replace(/[^a-z0-9]+/g, '-'),
          model: input.model,
          title: input.title ?? input.model,
          description: input.description ?? '',
          providerId: p.id,
          providerTitle: p.title,
          state: 'disabled',
          isDefault: false,
          audience: { mode: 'all' },
        };
        this.models = [...this.models, m];
        counted();
        return json({ model: modelDetail(m), report: answered(m) }, 201);
      }
      const m = this.models.find(x => x.id === id);
      if (!m) return missing('Modellen');
      if (action === 'test') return json(answered(m));
      if (method === 'DELETE') {
        this.models = this.models.filter(x => x.id !== id);
        counted();
        return json({ removed: true });
      }
      if (method === 'PATCH') {
        const patch = body() as Partial<ModelSummary>;
        if (patch.isDefault) this.models = this.models.map(x => ({ ...x, isDefault: false }));
        const next = {
          ...m,
          ...patch,
          ...(patch.state === 'disabled' ? { isDefault: false } : {}),
          updatedAt: new Date().toISOString(),
        };
        this.models = this.models.map(x => (x.id === id ? next : x));
        counted();
        return json(modelDetail(next));
      }
      return json(modelDetail(m));
    }
    if (!id && method === 'POST') {
      const input = body() as { id: string; title: string; baseUrl: string; apiKey?: string };
      const p: ProviderSummary = {
        ...this.providers[0]!,
        id: input.id,
        title: input.title,
        baseUrl: input.baseUrl,
        hasKey: !!input.apiKey,
        models: 0,
        enabledModels: 0,
      };
      this.providers = [...this.providers, p];
      return json({ provider: providerDetail(p), report: providerReport }, 201);
    }
    const p = this.providers.find(x => x.id === id);
    if (!p) return missing('Leverantören');
    if (action === 'test') return json(providerReport);
    if (action === 'key') {
      const next = { ...p, hasKey: !!body().apiKey, keyChangedAt: NOW };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    if (method === 'DELETE') {
      this.providers = this.providers.filter(x => x.id !== id);
      return json({ removed: true });
    }
    if (method === 'PATCH') {
      const next = { ...p, ...(body() as Partial<ProviderSummary>), updatedAt: new Date().toISOString() };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    return json(providerDetail(p));
  }
}

/** Records text that changes inside a live region. A region mounted together with its text is not announced, so it is not recorded. */
function recordAnnouncements() {
  const log: string[] = [];
  Object.assign(window, { announcements: log });
  const live = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const node = mutation.target;
      const region = (node instanceof Element ? node : node.parentElement)?.closest(live);
      const text = region?.textContent?.trim();
      if (text && log.at(-1) !== text) log.push(text);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript(recordAnnouncements);
    await page.route('**/api/**', route => api.handle(route));
    await use(api);
    expect(api.unmocked).toEqual([]);
  },
});
export { expect };

export const answer = (page: Page) =>
  page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' });
/** The box: named after the landing's heading, "Svara i samtalet" once a conversation is open (the scope line, H3.3). */
export const composer = (page: Page) => page.getByRole('combobox', { name: /^(Vad vill du göra|Svara i samtalet)$/ });
/** A heading by the level assistive technology gets: `aria-level` when Astryx separates it from the visual level. */
/** "Inte nu" on the first card, the way a person does it (D29): open the picker, choose "I morgon". */
export async function snoozeFirst(page: Page) {
  // A card keeps Inte nu in view (a phone draws cards); a row has only its next step (artboard A), so its card is opened beside the column first, where Inte nu stands in the panel's header (artboard E).
  const button = page.getByRole('main').getByRole('button', { name: 'Inte nu', exact: true }).first();
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole('main').getByRole('listitem').getByRole('link').first().click();
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
  }
  await page.getByRole('menuitem', { name: /^I morgon/ }).click();
  // Over the page the card is a drawer: it is let go of, so the toast and the page are reachable again.
  const drawer = page.getByRole('dialog', { name: 'Kort', exact: true });
  if (await drawer.isVisible()) {
    await drawer.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(drawer).toBeHidden();
  }
}
export const heading = (page: Page, level: number, name: string) =>
  page.locator(`h${level}:not([aria-level]), [aria-level="${level}"]`).filter({ hasText: name });
export const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);
/** The areas live in the shell's SideNav (D31); below the shell's breakpoint AppShell keeps it in a modal drawer that this opens. */
export async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Öppna navigering' });
  if (!(await toggle.isVisible())) return page.getByRole('navigation', { name: 'Sidonavigering' });
  await toggle.click();
  return page.getByRole('dialog', { name: 'Navigering' });
}
/** The surface that docks the composer: ChatLayout's sticky wrapper (D31), or null when the row is in the page flow. */
const dockOf = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
    while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position)) el = el.parentElement;
    return el ? (el.getBoundingClientRect().toJSON() as DOMRect) : null;
  });
export { dockOf };

/** Renders a route and waits for its data, so a check never runs against the empty shell. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Every rule tagged for WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices: landmarks, headings and regions. */
export async function expectNoAxeViolations(page: Page) {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const { violations } = await new AxeBuilder({ page }).withTags(tags).disableRules(['target-size']).analyze();
  // 2.5.8 is about the targets themselves: measured with the dock in the flow, so a row that has scrolled under the sticky dock is not read as too close to its buttons.
  const undock = (on: boolean) =>
    page.evaluate(on => {
      let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
      while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position) && !el.dataset.undocked)
        el = el.parentElement;
      if (!el) return;
      if (on) {
        el.dataset.undocked = el.style.position;
        el.style.position = 'static';
      } else {
        el.style.position = el.dataset.undocked ?? '';
        delete el.dataset.undocked;
      }
    }, on);
  await undock(true);
  const { violations: sizes } = await new AxeBuilder({ page }).withTags(tags).withRules(['target-size']).analyze();
  await undock(false);
  expect(
    [...violations, ...sizes].map(
      v =>
        `${v.id}: ${v.help}\n  ${v.nodes
          .slice(0, 4)
          .map(n => n.target.join(' ') + '\n  ' + n.html)
          .join('\n  ')}`,
    ),
  ).toEqual([]);
}

/**
 * 1.4.10: nothing may need sideways scrolling, and no text may be clipped to fit. A drawer still sliding in is not a
 * reflow fault, so finite animations settle first. `scope` limits the text to one surface, for a check made with the
 * rail open: the rail ends a long row with an ellipsis on purpose, and the page's width is still checked.
 */
export async function reflowProblems(page: Page, scope?: Locator) {
  const root = scope ? await scope.elementHandle() : null;
  return page.evaluate(async root => {
    await Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    );
    const width = document.documentElement.clientWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(),
        s = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none')) return false;
      // Astryx keeps hidden section headings in the accessibility tree. Their
      // descendants have text dimensions but are deliberately clipped by the
      // VisuallyHidden ancestor; they are not visible reflow failures.
      for (let parent: Element | null = el; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return false;
      }
      return true;
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 50)}"`;
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > width)
      problems.push(`page is ${document.documentElement.scrollWidth} px wide at ${width} px`);
    for (const el of (root ?? document.body).querySelectorAll('*')) {
      if (!visible(el)) continue;
      const position = getComputedStyle(el).position;
      if (position === 'absolute' && el.getBoundingClientRect().width <= 1) continue;
      if (el.getBoundingClientRect().right > width + 1 && el.children.length === 0 && el.textContent?.trim())
        problems.push(`beyond the edge: ${label(el)}`);
      const style = getComputedStyle(el);
      const clips = style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
      const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (clips && hasText && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${label(el)}`);
    }
    return [...new Set(problems)];
  }, root);
}

/** Tabs through the page and names every stop entirely hidden by sticky or fixed content (2.4.11) or without a focus ring (2.4.7). */
export async function hiddenFocusStops(page: Page, limit = 150) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    Object.assign(window, { unmarked: [], visited: [] });
  });
  const hidden: string[] = [];
  const seen = new Set<string>();
  for (let stop = 0; stop < limit; stop++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(async () => {
      // A tooltip closes about 100 ms after the focus leaves its button: what is measured is what stays, not the last frames of what is leaving.
      if ([...document.querySelectorAll('.astryx-tooltip')].some(tip => tip.getBoundingClientRect().width > 0))
        await new Promise(resolve => setTimeout(resolve, 150));
      // A ring that animates in (an Astryx field's border and inset shadow, 125 ms) is measured once it has settled, not in the instant of the Tab.
      await Promise.all(
        document
          .getAnimations()
          .filter(a => a instanceof CSSTransition && a.playState === 'running')
          .map(a => a.finished.catch(() => undefined)),
      );
      const { unmarked, visited } = window as unknown as { unmarked: string[]; visited: Element[] };
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      // The element itself decides whether the walk has come round, not its label and place: a row that scrolls into the previous row's spot is still a new stop.
      const again = visited.includes(active);
      visited.push(active);
      const r = active.getBoundingClientRect();
      const name = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 50)}" at ${Math.round(r.left)},${Math.round(r.top)}`;
      const ring = (el: Element | null, depth: number): boolean => {
        if (!el || depth > 3) return false;
        const s = getComputedStyle(el);
        // An Astryx field (TextInput, Typeahead) draws its ring as an inset shadow on the wrapper around the input; an elevation shadow is never inset.
        const fieldRing =
          el !== active &&
          /inset/.test(s.boxShadow) &&
          !/^rgba\(0, 0, 0, 0\)/.test(s.boxShadow) &&
          !/ 0px 0px 0px 0px inset/.test(s.boxShadow);
        return (
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          (el === active && s.boxShadow !== 'none') ||
          fieldRing ||
          ring(el.parentElement, depth + 1)
        );
      };
      if (!ring(active, 0)) unmarked.push(name);
      const box = {
        left: Math.max(r.left, 0),
        right: Math.min(r.right, innerWidth),
        top: Math.max(r.top, 0),
        bottom: Math.min(r.bottom, innerHeight),
      };
      if (box.right <= box.left || box.bottom <= box.top) return { name, again, covered: 'outside the viewport' };
      // The top layer (an open popover: the toast stack, a dialog) paints over everything else, so nothing below can obscure it.
      if (active.closest(':popover-open, dialog[open]')) return { name, again, covered: null };
      const layer = (e: Element) => parseInt(getComputedStyle(e).zIndex) || 0;
      const a = getComputedStyle(active);
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'sticky' && s.position !== 'fixed') continue;
        if (el.contains(active) || s.visibility === 'hidden') continue;
        // A stop that is itself lifted above the surface (the shell's skip link over its header) is on top, not under it.
        if ((a.position === 'fixed' || a.position === 'absolute') && layer(active) > layer(el)) continue;
        // A frosted layer (ChatLayout's dock) hides what is under it as surely as a painted one (D31).
        const frosted = (e: Element) =>
          getComputedStyle(e).backdropFilter !== 'none' ||
          [...e.children].some(c => getComputedStyle(c).backdropFilter !== 'none');
        const paints = s.backgroundImage !== 'none' || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || frosted(el);
        const o = el.getBoundingClientRect();
        if (paints && box.top >= o.top && box.bottom <= o.bottom && box.left >= o.left && box.right <= o.right)
          return { name, again, covered: el.className.toString().slice(0, 40) || el.tagName };
      }
      return { name, again, covered: null };
    });
    if (!result) {
      if (seen.size) break;
      continue;
    }
    if (result.again) break;
    seen.add(result.name);
    if (result.covered) hidden.push(`${result.name} is under ${result.covered}`);
  }
  expect(seen.size, 'the walk reached the controls').toBeGreaterThan(3);
  const unmarked = await page.evaluate(() => (window as unknown as { unmarked: string[] }).unmarked);
  return { hidden, unmarked, stops: [...seen] };
}

/** The focused element, as a person using a screen reader would be told about it. `body` means focus was lost. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName.toLowerCase(),
      text: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim(),
    };
  });
