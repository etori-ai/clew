# D33 · Browser reads go through one query cache; a mutation's thread is written into it

**Status:** accepted · **Date:** 2026-11-04 · **Area:** ui

**Decision.** `apps/web` reads the server through TanStack Query (`@tanstack/react-query` 5.105.3, MIT) and in no
other way:

1. **One client per confirmed session.** `Protected` (`apps/web/src/main.tsx`) creates the `QueryClient` and mounts
   `QueryClientProvider` inside `SessionBoundary`; the boundary's `onEnded` callback (new, `packages/ui/src/session.tsx`)
   clears it after the commit that replaced the children with the ended card, so nothing is left observing an empty
   cache. Memory only: no `persistQueryClient`, no `broadcastQueryClient`, nothing in browser storage. The cache lives
   across route changes because `Protected` stays mounted between `/`, `/kalender` and `/admin/*`.
2. **Every read is a query in `queries.ts`, its key in `query-keys.ts`.** A screen spreads the options into `useQuery`.
   It never calls `api.*` for a read, never keeps server data in `useState`, never writes an `alive` flag or a
   page-level `load()`. The one exception is the composer's `@` search, which is Astryx's own async `searchSource`
   with its own cancel.
3. **A mutation that returns a Thread goes through `applyThread`** (`thread-cache.ts`): it writes `['thread', id]`,
   replaces or prepends in `['threads']` (the list is newest first and keeps snoozed, handled and dismissed threads),
   re-reads areas and attention, and re-reads the loaded weeks only when the thread carries proposals. A list refetch
   in flight is cancelled first so an older answer cannot land afterwards. `useThreadAction` (`mutations.ts`) is the one
   `run` / `busy` / `error` helper for cards, rows, the calendar panel and the conversation; its `onChange` runs
   before the cache write so the start page can read the DOM for the focus hand-over (2.4.3). `useAdminAction` is
   the same for administration: it invalidates `['admin']` (or the keys the action names), waits for the refetch, then
   shows the toast the action returned. No window event, no `version` counter and no page `load()` refreshes anything.
4. **Policy** (`query-client.ts`, `query-policy.ts`). `staleTime` 15 s. A 5xx is retried once after a second; a 4xx is
   an answer and anything that is not an `ApiError` is the session ending, neither is retried. Reads refetch when the
   tab becomes visible again or the network returns; nothing polls. Mutations never retry (confirm sends invitations,
   act executes in a source system, remind starts a workflow). `cardViewQuery`, a POST used as a read, is never
   refetched on its own and replays within the session, which is right for a read action. A failed background
   refetch keeps the data it had and shows nothing; the page's `role="alert"` is for a read that has nothing to show.
   The day view and the model's status are extras: never retried, never the page's error.
5. **Loading and error UI stay as they were and stay Astryx**: `role="status"` text while a page reads, `role="alert"`
   text where an action failed, `Banner` for the model, toasts with Ångra that stay until dismissed, and Astryx's own
   pending state on `clickAction` / `changeAction` / `isActionLoading`, which is why `run` always returns a promise
   that settles. Busy never disables the button that holds focus.
6. **Tests.** Pure cache helpers (`thread-cache.ts`, `query-policy.ts`) are tested in `tests/unit` against a real
   `QueryClient` from `@tanstack/query-core` (a root devDependency; it has no React peer, so the root can carry it).
   Screens stay with `tests/a11y`, whose `MockApi` needs no new route: the cache changes when an endpoint is called,
   never which. Bun's isolated installs mean app code imports only `@tanstack/react-query` (it re-exports the
   `QueryClient` type) and `packages/ui` imports neither package.
7. **Licence record.** `@tanstack/react-query`, `@tanstack/query-core` and the development-only
   `@tanstack/react-query-devtools`, all 5.105.3 and MIT (`npm view`, 2026-11-04). The devtools are lazy-loaded
   behind `import.meta.env.DEV` and absent from the production bundle (verified with a grep of `dist/assets`).

**Why.** Before this, every screen fetched with `useState` + `useEffect` + a hand-written `load()` and kept its own
copy of server data. `start.tsx` held six pieces of server state, a `load()` with no race guard, a `replace()` that
patched the list by hand and re-read two counters, a `weeks` map that de-duplicated only after a response had landed,
and a window event `clew:refresh` that a reminder's timer used to make the page reload. The calendar page fetched the
whole thread list again to find its proposal thread and re-read the week with no `catch`. `card.tsx` carried a
module-level preset cache with a 60 s TTL that also cached failures. The `run` helper (busy, error, `onChange(await …)`)
existed five times and `handled.tsx` had none. `onChange` was drilled four levels so that mutations could reach the
page's state. Two latent bugs came from the same structure: the route `/vy/kort/:thread/:action` ran its POST in a
mount effect that StrictMode fires twice, and removing a connector reloaded the deleted id after navigating away.

One cache keyed by endpoint removes all of that with less code and no stale copies of a thread between the stream,
the conversation and the calendar. The alternatives weighed: SWR (smaller, but no mutation state, no `select`, no
devtools, and the same work to wire); React Router's loaders (the app is in declarative mode with no `createBrowserRouter`,
and loaders do not cache mutations' answers); keeping the hand-written hooks (the five costs above). A review of the
plan before building settled the design points that are not obvious from the library: the client under the boundary
rather than at module level (clearing a module-level client on `clew-session-ended` would make still-mounted cards
refetch into an aborted controller and announce alerts at logout; clearing in an effect cleanup double-fires every read
under StrictMode); a keys file shared by reads and writes; calendar invalidation only for threads with proposals;
`run` as a settled promise with a ref as the re-entry guard; the alert rule for background refetches. The plan and
the review live in the session's plan file; the measurements are in `HANDOVER.md` section 9 (session 24).

**Replaces.** Nothing numbered. It retires the `clew:refresh` window event, the per-page `load()` functions, the
`weeks` map and `onLoadWeek` prop on the start page, `presetCache` in `card.tsx`, the `version` counter on the
connector page, and `api.*` calls from components for reads.
