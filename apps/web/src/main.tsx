import {
  StrictMode,
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
} from 'react';
import { keys } from './query-keys';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Routes, Route, useLocation, useParams, useSearchParams } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import '@clew/ui/styles.css';
import { createQueryClient } from './query-client';
import { changeNotices } from './thread-cache';
import {
  LinkProvider,
  Providers,
  SessionBoundary,
  SessionUnreachable,
  VisuallyHidden,
  readSession,
  retryDelay,
  type BrowserSession,
  type SessionAnswer,
  type SessionShape,
} from '@clew/ui';
import type { Capability, RelationGrant, SessionUser, SiteHeaderView } from '@clew/contracts';
import { HeldCapabilities, HeldRelations, capabilitiesOf, relationsOf } from './capabilities';
import { FirstLoad } from './components/shell/first-load';
import { StartPage } from './pages/start';
import { TodoPage } from './pages/todo';
import { ItemPage } from './pages/item';
import { todoFromHem } from './work-items';
import { ConversationProvider } from './components/conversation/conversation-context';
import { formerReviewPage, legacyReview, reviewPageFrom } from './review-address';
import { clearDrafts } from './review-session';
import { forgetShown } from './conversation-shown';
import { CalendarPage } from './pages/calendar';
import { ToolPage } from './pages/tool';
import { ToolsPage } from './pages/tools';
import { NewsPage } from './pages/news';
import { AccountsPage } from './pages/accounts';
import { AccountReturnPage } from './pages/account-return';
import { ACCOUNTS_PATH, LINK_RETURN_PATH, LINK_WINDOW, accountReturn } from './linked-accounts';
import { LoginPage } from './pages/login';
import { ManifestReferencePage } from './pages/protocol';
import { ManifestPreviewPage } from './pages/protocol-preview';
import { AdminConnectorsPage } from './pages/admin/connectors';
import { AdminConnectorPage } from './pages/admin/connector';
import { AdminModelsPage } from './pages/admin/models';
import { AdminUsersPage } from './pages/admin/users';
import { AdminOrganisationPage } from './pages/admin/organisation';
import { PeopleReadRoute, StaffPage } from './pages/staff';
import { CompetencePage } from './pages/competence';
import { ApprovalPage, CompetenceMatrixPage } from './pages/competence-matrix';
import { CompetenceSearchPage } from './pages/competence-search';
import { PersonPage } from './pages/person';
import { UnitPage } from './pages/unit';
import { UnitsPage } from './pages/units';
import { ConversationsPage } from './pages/conversations';
import { AdminModelPage } from './pages/admin/model';
import { AdminProviderPage } from './pages/admin/provider';
import { AdminIndexPage, NotAdmin } from './pages/admin/shell';
import { AdminAppearancePage } from './pages/admin/appearance';
import { AdminCompetencePage } from './pages/admin/competence';
import { AdminCompetenceSourcesPage } from './pages/admin/competence-sources';
import { AdminCompetenceRequirementsPage } from './pages/admin/competence-requirements';
import { AdminCompetenceImportPage } from './pages/admin/competence-import';
import { BoardingPage, BoardingPersonReadPage, BoardingPlanReadPage } from './pages/boarding';
import { BoardingListPage } from './pages/boarding-list';
import { AdminBoardingPage } from './pages/admin/boarding';
import { AdminBoardingImportPage } from './pages/admin/boarding-import';
import { loadBranding, useBranding } from './branding';

type Shell = {
  session: BrowserSession;
  user: SessionUser;
  admin: boolean;
  capabilities: Capability[];
  /** D121: the relations to people held by grant: whether Kompetens offers its search. Never an admin flag. */
  relations: RelationGrant[];
};
/** `GET /api/auth/session` as the server answers it; `readSession` has checked the session's own part. */
type SessionData = SessionShape & { user: SessionUser; admin?: unknown; capabilities?: unknown; relations?: unknown };
const shellOf = (data: SessionData): Shell => ({
  session: {
    csrfToken: data.csrfToken,
    sessionKey: data.sessionKey,
    policyVersion: data.policyVersion,
    expiresAt: data.expiresAt,
  },
  user: data.user,
  admin: data.admin === true,
  capabilities: capabilitiesOf(data.capabilities),
  relations: relationsOf(data.relations),
});
/**
 * The shared header is public: it is read beside the session, so the first frame is the shell in its final shape
 * (`FirstLoad`), with the band when a header connector answers and without it when none does, never first one and then
 * the other (app critique, 2026-11-13). A failed read is no band, and the shell asks for it again.
 */
const readHeader = () =>
  fetch('/api/header', { cache: 'no-store' })
    .then(async response => (response.ok ? ((await response.json()) as SiteHeaderView) : null))
    .catch(() => null);
/**
 * The first load's reads leave together: the session and the shared header beside the installation's appearance, which
 * is read before anything is drawn, so the page's own reads leave one round trip after the first frame (L9 of the web
 * review of 2026-11-23). The first `Protected` takes them; a page drawn without a session (`/login`, the protocol's
 * pages) leaves them unread. Each is a promise of what was read, never of a response, so it can be taken twice.
 */
let firstSession: Promise<SessionAnswer<SessionData>> | null = readSession<SessionData>();
let firstHeader: Promise<SiteHeaderView | null> | null = readHeader();
/**
 * The cache inspector, development only and only when asked for (`VITE_QUERY_DEVTOOLS=true`): its floating button sits
 * over the page's bottom corner, where a box's send button is. The production bundle, the a11y suite and a deployment
 * never carry it.
 */
const Devtools =
  import.meta.env.DEV && import.meta.env.VITE_QUERY_DEVTOOLS === 'true'
    ? lazy(() => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })))
    : null;
/**
 * The protected tree mounts only after a live session is confirmed. No user content is kept in browser storage: the
 * query cache (D33) is one client per confirmed session, in memory, emptied once the boundary has shown the ended card.
 */
function Protected({ children }: { children: (shell: Shell) => React.ReactNode }) {
  // `unreachable` is a stage of its own, never a flag beside `loading`: once the shell is drawn nothing an older read
  // said can make the next read of the session show Clew out of reach (L13 of the review of batch 12).
  const [shell, setShell] = useState<Shell | 'loading' | 'unreachable' | 'anonymous'>('loading');
  const [header, setHeader] = useState<SiteHeaderView | null | undefined>(undefined);
  const [client] = useState(createQueryClient);
  const policy = useRef<string | undefined>(undefined);
  const headerRead = useRef<Promise<SiteHeaderView | null> | null>(null);
  // "Försök igen" on the page in Clew's place: asks at once, and says whether Clew answered.
  const askNow = useRef<() => Promise<boolean>>(async () => false);
  // Stops the change stream: the session's end leaves nobody to tell.
  const stopStream = useRef<() => void>(() => undefined);
  // The installation's name (D98), which the pages in Clew's place say.
  const site = useBranding().name;
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    const read = firstHeader ?? readHeader();
    headerRead.current = read;
    void read.then(view => {
      if (cancelled) return;
      firstHeader = null;
      setHeader(view);
      if (view) client.setQueryData(keys.header, view);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);
  // The person's access changed: the change stream's new policy, or the session's own check that found the same session
  // with a new authorization version. The protected tree goes, since chips, generated text and panel state can hold
  // what a source showed under the access before, and the session is read again as on the first load. Never an end.
  const readAgain = useCallback(() => {
    stopStream.current();
    void client.cancelQueries();
    client.clear();
    setShell('loading');
  }, [client]);
  // The session, on the first load and again after a change to the person's access. Only an explicit denial is the
  // sign-in page; Clew out of reach is said, and asked again with a wait that grows (`retryDelay`).
  const reading = shell === 'loading' || shell === 'unreachable';
  useEffect(() => {
    if (!reading) return;
    let cancelled = false,
      timer: number | undefined,
      failures = 0,
      latest = 0;
    const ask = (answer: Promise<SessionAnswer<SessionData>>): Promise<boolean> => {
      // Each read is numbered: an older one that answers after a newer has left says nothing.
      const attempt = ++latest;
      return answer.then(async result => {
        if (cancelled || attempt !== latest) return false;
        firstSession = null;
        if (result.state === 'unreachable') {
          setShell(current => (current === 'loading' || current === 'unreachable' ? 'unreachable' : current));
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void ask(readSession<SessionData>()), retryDelay(failures++));
          return false;
        }
        window.clearTimeout(timer);
        if (result.state === 'signed-out') {
          setShell('anonymous');
          return true;
        }
        await headerRead.current;
        if (cancelled || attempt !== latest) return false;
        setShell(shellOf(result.session));
        return true;
      });
    };
    askNow.current = () => {
      window.clearTimeout(timer);
      failures = 0;
      return ask(readSession<SessionData>());
    };
    void ask(firstSession ?? readSession<SessionData>());
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reading]);
  useEffect(() => {
    if (typeof shell !== 'object') return;
    let source: EventSource | undefined,
      stopped = false,
      retry: number | undefined,
      failures = 0;
    // A notice that arrives while the person's own request is on its way waits for its answer (D64).
    const notices = changeNotices(client);
    const connect = () => {
      window.clearTimeout(retry);
      source?.close();
      if (document.visibilityState === 'hidden' || stopped) return;
      const current = new EventSource('/api/changes');
      source = current;
      current.onopen = () => {
        failures = 0;
      };
      // A dropped connection is reconnected by the browser itself (it is CONNECTING again), but a reconnect answered
      // with an HTTP error, a 502 or a 503 while the server restarts, closes it for good (D46: "transient connection or
      // database failure allows reconnection"). It is opened again after a wait that grows; the first message on the
      // new connection is the current revision, so whatever was committed meanwhile is read again.
      current.onerror = () => {
        if (stopped || current !== source || current.readyState !== EventSource.CLOSED) return;
        retry = window.setTimeout(connect, retryDelay(failures++));
      };
      current.onmessage = event => {
        let change: { ended?: boolean; revision?: string; policy?: string };
        try {
          change = JSON.parse(event.data);
        } catch {
          return;
        }
        if (change.ended) {
          // The server ended the session: every end takes the boundary's one way (its words said, the tab named, the
          // other tabs told, `onEnded`), never straight to the sign-in page.
          stop();
          window.dispatchEvent(new Event('clew-session-ended'));
          return;
        }
        if (typeof change.policy !== 'string' || typeof change.revision !== 'string') return;
        const revoked = policy.current !== undefined && policy.current !== change.policy;
        policy.current = change.policy;
        if (revoked) readAgain();
        else notices.arrived(change.revision);
      };
    };
    const reconnect = () => {
      failures = 0;
      connect();
    };
    const stop = () => {
      stopped = true;
      window.clearTimeout(retry);
      source?.close();
    };
    stopStream.current = stop;
    connect();
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('online', reconnect);
    return () => {
      stop();
      notices.stop();
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('online', reconnect);
    };
  }, [client, shell, readAgain]);
  // Nobody is signed in: nothing of a session before stays in this tab's storage, no review's draft
  // (`review-session.ts`) and nothing a conversation showed (`conversation-shown.ts`).
  useEffect(() => {
    if (shell === 'anonymous') {
      clearDrafts();
      forgetShown();
    }
  }, [shell]);
  // Clew did not answer the session's read: said in the page's place, and asked again (D46), never a sign-out.
  if (shell === 'unreachable') return <SessionUnreachable site={site} onRetry={() => askNow.current()} />;
  // Until the header has answered nothing is drawn, so the shell does not change shape when it does; then the shell's
  // shape stands until the session is known.
  if (shell === 'loading')
    return header === undefined ? (
      <VisuallyHidden role="status">Hämtar sidan …</VisuallyHidden>
    ) : (
      <FirstLoad header={header} />
    );
  // The whole address, so a link followed before signing in lands where it led, its query included (D116).
  if (shell === 'anonymous') return <LoginPage returnTo={location.pathname + location.search} />;
  // The review lay over a page in its own part of the address until 2026-11-12; such an address leads to its page.
  const reviewPage = reviewPageFrom(location.pathname, location.search);
  if (reviewPage) return <Navigate to={reviewPage} replace />;
  return (
    <SessionBoundary
      site={site}
      session={shell.session}
      onAccessChanged={readAgain}
      onEnded={() => {
        stopStream.current();
        client.clear();
        clearDrafts();
        forgetShown();
      }}
    >
      <QueryClientProvider client={client}>
        {/* One conversation for the whole session's pages (D50): asked on Hem, it is still there when the transcript takes the column, and no other page has a box of its own (D126 rule 5). */}
        <ConversationProvider>
          <HeldCapabilities.Provider value={shell.capabilities}>
            <HeldRelations.Provider value={shell.relations}>{children(shell)}</HeldRelations.Provider>
          </HeldCapabilities.Provider>
        </ConversationProvider>
        {Devtools && (
          <Suspense fallback={null}>
            <Devtools initialIsOpen={false} buttonPosition="bottom-right" />
          </Suspense>
        )}
      </QueryClientProvider>
    </SessionBoundary>
  );
}
/** Every Astryx link navigates client-side through react-router; API and external addresses stay plain anchors. */
const RouterLink = forwardRef<
  HTMLAnchorElement,
  { href?: string; to?: string } & AnchorHTMLAttributes<HTMLAnchorElement>
>(function RouterLink({ href, to, ...rest }, ref) {
  const target = typeof to === 'string' ? to : href;
  if (!target || /^(https?:)?\/\//.test(target) || target.startsWith('/api/'))
    return <a ref={ref} href={target} {...rest} />;
  return <Link ref={ref} to={target} {...rest} />;
});
/**
 * Routes (D34, D50, D112): `/` is Hem, the box under one heading with what needs the person and the day under it;
 * `/conversations/:id` a conversation in the same column (`/conversations/new` while a question asked on another page
 * is being answered). `/todo` is Att göra, the queue, with the pile as `tab`, the system as `area` and the chosen work item as `item` (`work-items.ts`); Hem's addresses from before it (`/?card=`, `/?tab=`,
 * `/?area=`) lead there. What the panel holds is in the query of whichever page it is beside (`panel-address.ts`).
 * `/items/:threadId` is a work item as a page (D112 item 4), with `from` as the way back; for an item reviewed one row
 * at a time it is the review too, with the step as `step` (D142, `review-address.ts`). `/calendar` and `/tools/:capability` are the tools, each a page of its own in the same shell
 * (D42). The review's addresses from before are cold links only: `?review=<threadId>&step=n` over any page and
 * `/cards/:threadId/review` and `/items/:threadId/review` lead to the item's page at the step they named; `/cards/:threadId` leads to the item's page.
 */
function App() {
  // One element for every start route: a route change between Hem and a conversation re-renders the page
  // and never remounts it, so focus, the cache's observers and the composer's draft survive the change.
  const start = <Protected>{shell => <StartRoute user={shell.user} admin={shell.admin} />}</Protected>;
  // Administration (D23): the entry point shows only to an administrator, and every call is checked again on the server.
  const admin = (page: (shell: Shell) => React.ReactNode) => (
    <Protected>{shell => (shell.admin ? page(shell) : <NotAdmin />)}</Protected>
  );
  // A return the server could not place (a link that ran out) lands on a page of Clew inside the window the person
  // signed in in (D147 item 6): the window's return page takes it, so that Clew is not drawn in the small window.
  const location = useLocation();
  if (window.name === LINK_WINDOW && location.pathname !== LINK_RETURN_PATH && accountReturn(location.search))
    return <Navigate to={LINK_RETURN_PATH + location.search} replace />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage returnTo="/" />} />
      {/* Where a system returns the window a person signed in in (D147 item 6): it tells the page that opened it, and closes. */}
      <Route path={LINK_RETURN_PATH} element={<AccountReturnPage />} />
      {/* Integrator documentation, public like the login (D60): the manifest field by field, drawn from the instance's own schema. */}
      <Route path="/protocol/manifest" element={<ManifestReferencePage />} />
      {/* What Clew would do with a manifest, before anything is registered (D60, D97): public, the document posted to the dry run. */}
      <Route path="/protocol/preview" element={<ManifestPreviewPage />} />
      <Route
        path="/calendar"
        element={<Protected>{shell => <CalendarPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* "Kopplade konton" (D147): the person's linked accounts, from the person's menu. */}
      <Route
        path={ACCOUNTS_PATH}
        element={<Protected>{shell => <AccountsPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* "Alla nyheter" (D112, amended 2026-11-11): the combined news list at a tool's address, placed in the rail or not. */}
      <Route
        path="/tools/clew.news"
        element={<Protected>{shell => <NewsPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A report's own registration (D108 item 7): the page of the read its card opens is the decision over the matrix. */}
      <Route path="/tools/competence.approval" element={<ApprovalPage />} />
      {/* Introduktion och avslut (D124, D116): the pages of its two reads are the plan's page, keyed on the person. */}
      <Route
        path="/tools/boarding.plan"
        element={<Protected>{shell => <BoardingPlanReadPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route
        path="/tools/boarding.person"
        element={<Protected>{shell => <BoardingPersonReadPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A read about the reader's people is Personal's tab or the person's page (D126 rules 1 and 8, `PeopleReadRoute`). */}
      <Route
        path="/tools/:capability"
        element={
          <Protected>
            {shell => (
              <PeopleReadRoute user={shell.user}>
                <ToolPage user={shell.user} admin={shell.admin} />
              </PeopleReadRoute>
            )}
          </Protected>
        }
      />
      {/* Alla verktyg (D126 rule 7): every tool the person may open, where the rail's first few end. */}
      <Route
        path="/tools"
        element={<Protected>{shell => <ToolsPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Personal (D94): a manager's destination; the page itself tells anyone else, and the server refuses the read. */}
      <Route
        path="/staff"
        element={<Protected>{shell => <StaffPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Kompetens (D120 item 8): the reader's own, and a manager's matrix of their reports (D108 item 11); the server checks both. */}
      <Route
        path="/competence"
        element={<Protected>{shell => <CompetencePage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route
        path="/competence/matrix"
        element={<Protected>{shell => <CompetenceMatrixPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Kompetenssökning (D121 item 4): who in the organisation holds a type, for the holder of the relation `registrar`. */}
      <Route
        path="/competence/search"
        element={<Protected>{shell => <CompetenceSearchPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A person as a page (D97 item 5, D111 rule 3): a name on Personal or on any row that names them; `section` is the chosen source. */}
      <Route
        path="/people/:key"
        element={<Protected>{shell => <PersonPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Introduktion och avslut (D124 item 12): the reader's list, where the rail's row leads a manager. */}
      <Route
        path="/boarding"
        element={<Protected>{shell => <BoardingListPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* One person's introduction or leaving (D124): `/boarding/{id}` is the way in `boarding.person` declares, and where
        the rail's row leads someone whose own plan is the only one they have. */}
      <Route
        path="/boarding/:personId"
        element={<Protected>{shell => <BoardingPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A unit as a page (D97 items 5 and 6): reached from Läget on Hem and any row that names the unit; no rail entry. */}
      <Route
        path="/units/:id"
        element={<Protected>{shell => <UnitPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Dialogstöd (D116, D117): the units the reader follows up side by side, at the address every unit page shares, so
        the entry under Start stays marked from the overview through each unit. */}
      <Route
        path="/units"
        element={<Protected>{shell => <UnitsPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route
        path="/admin"
        element={admin(shell => (
          <AdminIndexPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/connectors"
        element={admin(shell => (
          <AdminConnectorsPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/connectors/:id"
        element={admin(shell => (
          <AdminConnectorPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/models"
        element={admin(shell => (
          <AdminModelsPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/users"
        element={admin(shell => (
          <AdminUsersPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/organisation"
        element={admin(shell => (
          <AdminOrganisationPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/models/providers/:id"
        element={admin(shell => (
          <AdminProviderPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/appearance"
        element={admin(shell => (
          <AdminAppearancePage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/competence"
        element={admin(shell => (
          <AdminCompetencePage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/competence/sources"
        element={admin(shell => (
          <AdminCompetenceSourcesPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/competence/requirements"
        element={admin(shell => (
          <AdminCompetenceRequirementsPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/competence/import"
        element={admin(shell => (
          <AdminCompetenceImportPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/boarding"
        element={admin(shell => (
          <AdminBoardingPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/boarding/import"
        element={admin(shell => (
          <AdminBoardingImportPage user={shell.user} />
        ))}
      />
      <Route
        path="/admin/models/:id"
        element={admin(shell => (
          <AdminModelPage user={shell.user} />
        ))}
      />
      <Route
        path="/todo"
        element={<Protected>{shell => <TodoPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A work item as a page (D112 item 4): its title in the reading pane and the panel leads here; `from` is the way back. */}
      <Route
        path="/items/:threadId"
        element={<Protected>{shell => <ItemPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* The review was a page beside the item's until 2026-11-21 (D142): its address leads to the item's page. */}
      <Route path="/items/:threadId/review" element={<Protected>{() => <FormerReview />}</Protected>} />
      {/* What was a card is a work item (D112 item 4): its address leads to the item's page. */}
      <Route path="/cards/:threadId" element={<Protected>{() => <LegacyItem />}</Protected>} />
      <Route path="/" element={start} />
      {/* Alla samtal (D126 rule 7): every conversation, where the rail's three latest end. */}
      <Route
        path="/conversations"
        element={<Protected>{shell => <ConversationsPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route path="/conversations/:conversationId" element={start} />
      {/* Signed in first, so a link followed before signing in still lands in the review afterwards. */}
      <Route path="/cards/:threadId/review" element={<Protected>{() => <LegacyReview />}</Protected>} />
      <Route path="*" element={start} />
    </Routes>
  );
}
function StartRoute({ user, admin }: { user: SessionUser; admin: boolean }) {
  // A tab or an area in Hem's address is from before Att göra (D112): the same pile is in the queue now. A card alone
  // is Hem's own, beside it in the panel (D112, amended 2026-11-12).
  const { pathname, search } = useLocation();
  const moved = pathname === '/' ? todoFromHem(search) : null;
  if (moved) return <Navigate to={moved} replace />;
  return <StartPage user={user} admin={admin} />;
}
/** `/cards/:threadId`: the work item's page (D112 item 4), as a card's address is now an item's. */
function LegacyItem() {
  const { threadId = '' } = useParams<{ threadId: string }>();
  return <Navigate to={`/items/${encodeURIComponent(threadId)}`} replace />;
}
/** `/items/:threadId/review?step=n`, the review's page until 2026-11-21: the item's page at that step. */
function FormerReview() {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  return <Navigate to={formerReviewPage(threadId, search)} replace />;
}
/** `/cards/:threadId/review?step=n`, the review's first address: its page at that step. */
function LegacyReview() {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  return <Navigate to={legacyReview(threadId, search)} replace />;
}
/** The installation's theme (D98) around everything: a save on Utseende redraws the whole app without a reload. */
function Root() {
  const branding = useBranding();
  return (
    <Providers branding={branding}>
      <BrowserRouter>
        <LinkProvider component={RouterLink}>
          <App />
        </LinkProvider>
      </BrowserRouter>
    </Providers>
  );
}
void loadBranding().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  ),
);
