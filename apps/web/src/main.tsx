import { StrictMode, Suspense, forwardRef, lazy, useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Routes, Route, useLocation, useParams, useSearchParams } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import '@clew/ui/styles.css';
import { createQueryClient } from './query-client';
import { changeNotices } from './thread-cache';
import { Center, LinkProvider, Providers, SessionBoundary, Spinner, type BrowserSession } from '@clew/ui';
import type { SessionUser } from '@clew/contracts';
import { StartPage } from './pages/start';
import { ConversationProvider } from './components/conversation-context';
import { PanelClaims } from './components/page-panel';
import { ReviewOverlay } from './components/review-overlay';
import { legacyReview } from './review-address';
import { CalendarPage } from './pages/calendar';
import { ToolPage } from './pages/tool';
import { LoginPage } from './pages/login';
import { ManifestReferencePage } from './pages/protocol';
import { ManifestPreviewPage } from './pages/protocol-preview';
import { AdminConnectorsPage } from './pages/admin/connectors';
import { AdminConnectorPage } from './pages/admin/connector';
import { AdminModelsPage } from './pages/admin/models';
import { AdminUsersPage } from './pages/admin/users';
import { AdminOrganisationPage } from './pages/admin/organisation';
import { StaffPage } from './pages/staff';
import { PersonPage } from './pages/person';
import { UnitPage } from './pages/unit';
import { AdminModelPage } from './pages/admin/model';
import { AdminProviderPage } from './pages/admin/provider';
import { NotAdmin } from './pages/admin/shell';
import { AdminAppearancePage } from './pages/admin/appearance';
import { loadBranding, useBranding } from './branding';

type Shell = { session: BrowserSession; user: SessionUser; admin: boolean };
/** The cache inspector, development only: the production bundle, the a11y suite and a deployment never carry it. */
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })))
  : null;
/**
 * The protected tree mounts only after a live session is confirmed. No user content is kept in browser storage: the
 * query cache (D33) is one client per confirmed session, in memory, emptied once the boundary has shown the ended card.
 */
function Protected({ children }: { children: (shell: Shell) => React.ReactNode }) {
  const [shell, setShell] = useState<Shell | 'loading' | 'anonymous'>('loading');
  const [client] = useState(createQueryClient);
  const policy = useRef<string | undefined>(undefined);
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async response => {
        if (cancelled) return;
        if (!response.ok) {
          setShell('anonymous');
          return;
        }
        const data = await response.json();
        setShell({
          session: { csrfToken: data.csrfToken, sessionKey: data.sessionKey, expiresAt: data.expiresAt },
          user: data.user,
          admin: data.admin === true,
        });
      })
      .catch(() => {
        if (!cancelled) setShell('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (shell === 'loading' || shell === 'anonymous') return;
    let source: EventSource | undefined,
      stopped = false;
    // A notice that arrives while the person's own request is on its way waits for its answer (D64).
    const notices = changeNotices(client);
    const connect = () => {
      source?.close();
      if (document.visibilityState === 'hidden' || stopped) return;
      source = new EventSource('/api/changes');
      source.onmessage = event => {
        let change: { ended?: boolean; revision?: string; policy?: string };
        try {
          change = JSON.parse(event.data);
        } catch {
          return;
        }
        if (change.ended) {
          source?.close();
          void client.cancelQueries();
          client.clear();
          setShell('anonymous');
          return;
        }
        if (typeof change.policy !== 'string' || typeof change.revision !== 'string') return;
        const revoked = policy.current !== undefined && policy.current !== change.policy;
        policy.current = change.policy;
        if (revoked) {
          // Reset the protected tree too: chips, generated text and panel state can contain retained source snapshots.
          source?.close();
          void client.cancelQueries();
          client.clear();
          setShell('loading');
          fetch('/api/auth/session', { cache: 'no-store' })
            .then(async response => {
              if (!response.ok) {
                setShell('anonymous');
                return;
              }
              const data = await response.json();
              setShell({
                session: { csrfToken: data.csrfToken, sessionKey: data.sessionKey, expiresAt: data.expiresAt },
                user: data.user,
                admin: data.admin === true,
              });
            })
            .catch(() => setShell('anonymous'));
        } else notices.arrived(change.revision);
      };
    };
    connect();
    document.addEventListener('visibilitychange', connect);
    window.addEventListener('online', connect);
    return () => {
      stopped = true;
      notices.stop();
      source?.close();
      document.removeEventListener('visibilitychange', connect);
      window.removeEventListener('online', connect);
    };
  }, [client, shell]);
  if (shell === 'loading')
    return (
      <Center height="100%" role="main">
        <Spinner label="Hämtar sidan …" />
      </Center>
    );
  if (shell === 'anonymous') return <LoginPage returnTo={location.pathname} />;
  return (
    <SessionBoundary session={shell.session} onEnded={() => client.clear()}>
      <QueryClientProvider client={client}>
        {/* One conversation for the whole session's pages (D50): asked on a tool's page, it is still there when the transcript takes the column. Every page has the panel: the pages that draw it beside their column claim it, and the shell draws it over the others. A card's review lies over whichever page it was opened on (D110 rule 5): one overlay for every page, after the page in the tree, so it stacks over the card the same update opens. */}
        <ConversationProvider>
          <PanelClaims>
            {children(shell)}
            <ReviewOverlay />
          </PanelClaims>
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
 * Routes (D34, D50, D53): `/` is Hem, the box with everything the assistant has pushed, a card's state as `tab` and
 * the areas as `area`; `/conversations/:id` a conversation in the same column (`/conversations/new` while a question
 * asked on another page is being answered). What the panel holds is in the query of whichever page it is beside
 * (`panel-address.ts`), and so is a card's review one row at a time, which lies over the page it was opened on
 * (`?review=<threadId>&step=n`, `review-address.ts`; D73 amended under D110 rule 5). `/calendar` and
 * `/tools/:capability` are the tools, each a page of its own in the same shell (D42). `/cards/:threadId/review`, the
 * review's address before that, is a cold link only: it leads to Hem with the card beside the column and the review over
 * both, at the step it named.
 */
function App() {
  // One element for every start route: a route change between Hem and a conversation re-renders the page
  // and never remounts it, so focus, the cache's observers and the composer's draft survive the change.
  const start = <Protected>{shell => <StartRoute user={shell.user} admin={shell.admin} />}</Protected>;
  // Administration (D23): the entry point shows only to an administrator, and every call is checked again on the server.
  const admin = (page: (shell: Shell) => React.ReactNode) => (
    <Protected>{shell => (shell.admin ? page(shell) : <NotAdmin />)}</Protected>
  );
  return (
    <Routes>
      <Route path="/login" element={<LoginPage returnTo="/" />} />
      {/* Integrator documentation, public like the login (D60): the manifest field by field, drawn from the instance's own schema. */}
      <Route path="/protocol/manifest" element={<ManifestReferencePage />} />
      {/* What Clew would do with a manifest, before anything is registered (D60, D97): public, the document posted to the dry run. */}
      <Route path="/protocol/preview" element={<ManifestPreviewPage />} />
      <Route
        path="/calendar"
        element={<Protected>{shell => <CalendarPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route
        path="/tools/:capability"
        element={<Protected>{shell => <ToolPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* Personal (D94): a manager's destination; the page itself tells anyone else, and the server refuses the read. */}
      <Route
        path="/staff"
        element={<Protected>{shell => <StaffPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A person as a page (D97 item 5, D110 rule 3): a name on Personal or on any row that names them; `section` is the chosen source. */}
      <Route
        path="/people/:key"
        element={<Protected>{shell => <PersonPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      {/* A unit as a page (D97 items 5 and 6): reached from Läget on Hem and any row that names the unit; no rail entry. */}
      <Route
        path="/units/:id"
        element={<Protected>{shell => <UnitPage user={shell.user} admin={shell.admin} />}</Protected>}
      />
      <Route
        path="/admin"
        element={admin(shell => (
          <AdminConnectorsPage user={shell.user} />
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
        path="/admin/models/:id"
        element={admin(shell => (
          <AdminModelPage user={shell.user} />
        ))}
      />
      <Route path="/" element={start} />
      <Route path="/conversations/:conversationId" element={start} />
      {/* Signed in first, so a link followed before signing in still lands in the review afterwards. */}
      <Route path="/cards/:threadId/review" element={<Protected>{() => <LegacyReview />}</Protected>} />
      <Route path="*" element={start} />
    </Routes>
  );
}
function StartRoute({ user, admin }: { user: SessionUser; admin: boolean }) {
  return <StartPage user={user} admin={admin} />;
}
/** `/cards/:threadId/review?step=n` from before the review lay over its page: the same review over Hem's card, in its place. */
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
