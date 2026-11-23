# Review · the web app's data, state and errors

Date: 2026-11-23. Commit reviewed: `9fd4c962` on `main`. Wave 2 of the review of the whole system.

**Area.** The logic of `apps/web/src`: the API client and its errors (`api.ts`, `api-error.ts`), the query cache (`queries.ts`, `query-client.ts`, `query-keys.ts`, `query-policy.ts`), mutations and predictions (`mutations.ts`, `optimistic.ts`, `thread-cache.ts`), the stream and its helpers (`stream.ts`, `linger.ts`, `delivery-toast.ts`, `logged-reads.ts`), actions and their state (`action-requests.ts`, `action-path.ts`, `entity-actions.ts`, `execution-status.ts`, `receipt-state.ts`, `status-of.ts`, `review-session.ts`), `capabilities.ts`, the `*-address.ts` files, `page-location.ts`, `page-title.ts`, `main.tsx` and its routes, the data flow of the pages and of the components that read or write, `apps/web/tests`, `index.html`, `vite.config.ts` and `nginx.conf.template`. The session boundary in `packages/ui/src/session.tsx` is read with it, since `main.tsx` mounts the cache inside it (D33 item 1).

**Not this review's.** Composition, Astryx and accessibility (session 9), and the domain rules of competence, boarding, dialogue and talks (sessions 6 and 7).

**Method.** Each finding is established in one of three ways, and the finding says which:

- **Reading the code**, at `9fd4c962`.
- **A temporary unit probe** on the memory thread store and a TanStack `QueryClient` (`bun test` on that single file).
- **A temporary Playwright probe** against the accessibility suite's mocked API (`tests/a11y/support.ts`). It ran in a container of its own with only this worktree mounted, on the pinned Playwright 1.65.0 image. The production bundle that this run built was also scanned for what a content security policy must allow.

Both probes and the build output were removed before this commit. The development server and the shared database were not used as evidence.

## Summary

| Severity | Count | Findings |
| --- | --- | --- |
| High | 0 | |
| Medium | 4 | M1 a transient failure ends the session in every tab; M2 the change stream stays closed after one failed reconnect; M3 a link opened signed out loses its query; M4 typed text and user names travel in request addresses |
| Low | 9 | L1–L9 |

The cache work of D33, D46 and D64 holds up well:

- A mutation's answer is written in place.
- A list refetch that left earlier is cancelled first.
- A notice that arrives while the person's own request is in flight waits for it.
- A reconnect compares revisions, so a sleeping tab catches up.
- A policy change clears everything.

The weak points are at the edges of that design:

- **Telling an outage from the session's end.** The session boundary cannot tell an outage from a sign-out (M1).
- **Reconnecting the change stream.** The stream gives up after one failed reconnect (M2).
- **Addresses.** An address loses its query on the way through sign-in (M3), and typed text and user names are sent as query strings that nginx's default access log keeps (M4).

The three follow-ups from wave 1 are answered at the end: what a content security policy must allow, how a decision could be bound to what was shown, and what the change stream's re-authentication costs.

## Findings

### Medium

#### M1 · A transient failure ends the session, in every tab, and the page's unsaved input with it

`packages/ui/src/session.tsx:98`, `:106`, `:119`, `:124` (with `:85-92` and `:154-157`). Also `apps/web/src/main.tsx:100-116` for the first load and `apps/web/src/main.tsx:153-167` for the session re-read after a policy change.

The session boundary asks `GET /api/auth/session` on focus, on `pageshow` and every 15 s, and posts activity at most every 30 s. Every outcome other than a 2xx with the same `sessionKey` calls `end()`:

- `if (!response.ok) return end();` (`:98`, `:119`);
- `catch { end(); }` (`:106`, `:124`).

`end()` aborts every request, replaces the page with "Din inloggning har avslutats. Logga in igen för att fortsätta." and posts `ended` on the `clew-session` BroadcastChannel. Every other tab of the same session then ends without asking the server (`:156`).

The failures that end the session this way:

- A 503. The server answers 503 "Något gick fel. Försök igen." for any error that is not an `AuthError` (`apps/server/src/context.ts:62`), and `/session` goes through `protectedRoute` (`apps/server/src/routes/auth.ts:81`). A short database outage or the readiness guard during a restart therefore gives 503.
- A 502 from nginx while the BFF restarts.
- A network error, for example a laptop that loses its wifi for one poll.

**Scenario.** A deploy restarts the BFF.

1. Within 15 s, every open tab in the organisation polls, gets a 502 or a 503, and shows the ended card. Each tab broadcasts the end to its siblings.
2. The server-side session is still valid, so this is not a sign-out.
3. Whatever the person was typing is unmounted with the tree, and `onEnded` clears the cache (`main.tsx:202-205`). That includes an action dialog's answers, the composer's text and a reason.

The first load does the same: a non-OK or failed `/api/auth/session` shows the sign-in page (`main.tsx:100-116`), so an outage reads as "you are signed out". The policy-change path's re-read also treats any failure as signed out (`main.tsx:153-167`).

This goes against D46: "Explicit session denial ends the session; transient connection or database failure allows reconnection". The server keeps that distinction on its side: the change stream sends `{ended:true}` only on a 401 or 403 (`apps/server/src/routes/api.ts:209-212`). The browser does not keep it.

**How established.** By reading, and by the Playwright probe:

- `A1: both tabs show the ended card after one 503`: one tab's `/api/auth/session` answered 503 on focus, and both tabs ended.
- `A2: ended card after one failed fetch`: the request was aborted as `internetdisconnected`.

**Severity.** Medium. It is availability rather than authorization, but it loses typed input and signs out a whole installation at every restart. Status announcements also say something false: the person is told their sign-in ended.

#### M2 · The change stream stays closed after one failed reconnect

`apps/web/src/main.tsx:126-130` and `:172-173`; the server side is `apps/server/src/routes/api.ts:205-212`.

The browser's `EventSource` has an `onmessage` and no `onerror`, and it is reopened only on `visibilitychange` and `online`.

When a connection drops, `EventSource` reconnects by itself after the server's `retry: 5000`. If that reconnect is answered with an HTTP error (a 502 or 503 during a restart, or any outage longer than five seconds), the specification makes the `EventSource` fail for good (`readyState` 2). Nothing in the page reopens it until the tab is hidden and shown again or the operating system fires `online`. In a tab the person keeps in front of them, that may be hours.

**Scenario.**

1. A person works with Att göra open on a second screen.
2. The database blinks for ten seconds. The server's loop breaks and closes the stream (`api.ts:213`), as its comment intends: "A database/network outage closes the stream so EventSource reconnects".
3. The reconnect five seconds later gets a 503 and the `EventSource` closes.

From then on, no new work item, reminder, receipt or decision made in another tab reaches the page; reads refresh only on focus and on the 15-s stale time. Two pages claim more than this delivers:

- the work status page: "Authenticated SSE invalidates the query cache using committed revisions" (`docs/reference/status/work.md:79`);
- the reliability acceptance page: "SSE invalidation on every page" (`docs/reference/reliability-acceptance.md:13`).

Both hold only while the stream is open, and nothing reopens it.

D46 says: "Hidden tabs suspend the stream and reconnect on visibility/network recovery … transient connection or database failure allows reconnection". The browser half of that is missing.

**How established.** Playwright probe. The first `/api/changes` answered with a revision and `retry: 300`, and the second answered 503. Six seconds later:

```
B: requests to /api/changes 2 EventSource readyStates [2]
```

The probe recorded no third request.

**Severity.** Medium. Silent staleness of the queue is the failure D46 exists to prevent. It combines with M1: a tab that survives the outage still goes stale.

#### M3 · A link opened signed out loses its query, and "Logga in igen" loses the whole address

`apps/web/src/main.tsx:195`, `apps/web/src/pages/login.tsx:29` and `:50`, `packages/ui/src/session.tsx:195`.

When nobody is signed in, `Protected` renders `<LoginPage returnTo={location.pathname} />`, which is the path without `location.search`. The login page sends `returnTo` on to `/api/auth/login`.

The server would keep the query: `localReturnTo` keeps `url.pathname + url.search` (`apps/server/src/auth-crypto.ts:112-118`).

After a session has ended, the ended card's "Logga in igen" is `href="/api/auth/login"` with no `returnTo` at all (`session.tsx:195`), so the person comes back to Hem.

Under D116 every view has an address, and much of what an address names lives in its query:

- Att göra's reading pane and tab (`/todo?item=…&tab=…`);
- the review's step (`/items/<id>/review?step=2`);
- a tool's input (`/tools/<capability>?input=…`);
- the competence matrix's set of columns, a dialog over a page, and the way back (`from`).

**Scenario.** A manager clicks a link from an e-mail or a chat message to `/todo?item=ledighet&tab=waiting` while signed out, signs in, and lands on `/todo` with nothing open. The same person, timed out in the middle of a review, presses "Logga in igen" and lands on Hem.

**How established.** Playwright probe, with the harness's session signed out:

```
C: /todo?item=ledighet&tab=waiting -> /api/auth/login?returnTo=%2Ftodo
C: /items/ledighet/review?step=2 -> …returnTo=%2Fitems%2Fledighet%2Freview
C: /tools/hr.person?input=%7B%22person%22%3A%22anna%22%7D -> …returnTo=%2Ftools%2Fhr.person
```

The ended card's `href` was established by reading.

**Severity.** Medium. It defeats the deep links D116 and D73 promise for everyone who follows one from outside a session. The fix belongs together with M4: an address that keeps a user name in its query should not travel through sign-in either.

The browser-side check `returnTo.startsWith('/')` also accepts `//host`. The server is the gate there (the identity review's finding 2), so this is not reported again.

#### M4 · Typed text and user names travel in request addresses, where nginx's default access log keeps them

Four places send what a person typed, or a user name, as a query string:

1. **The composer's `@` search** (`apps/web/src/components/conversation/composer.tsx:187`). Each keystroke after the trigger asks `GET /api/objects?q=<typed>` (`apps/web/src/api.ts:514`). What a person types after `@` is usually a person's name.
2. **A view's search field** (`apps/web/src/components/views/view.tsx:455-467`). After 350 ms the typed text goes into the view's input. On the tool page that input is written into the address (`apps/web/src/pages/tool.tsx:284-286`, `apps/web/src/view-address.ts:50`), so it lands in the browser history, and the read is `GET /api/cap/<name>?input=<json>` (`api.ts:585-588`). The phonebook's `query` (`connectors/phonebook/manifest.mjs:82`) is a name search of exactly this kind.
3. **The talks drawer.** It reads one employee's commitments with `read('clew.commitments', { person })` (`api.ts:269`, `:312-313`), and `person` is `personKey(person)` = the user name, falling back to the id (`apps/web/src/talks.ts:19`, `apps/web/src/components/people/talk-overlay.tsx:134`). Every open of a person's talk sends `GET /api/cap/clew.commitments?input={"person":"<user name>"}`.
4. **Att göra's filter field** writes what is typed into `/todo?filter=` (`apps/web/src/pages/todo.tsx:204`, `:407`).

`apps/web/nginx.conf.template` sets no `access_log` or `log_format`, so the image's default `combined` log records `$request`, query string included, for every `/api/` request.

The server is careful on its own side: a request span records the path without the query, for this very reason (`apps/server/src/request-spans.ts:6-9`). The people list moved its typed search into a request body for the same reason: "never becomes part of an address, a browser history or an access log" (`docs/decisions/D100-the-people-list-is-read-a-page-at-a-time-and-narrowed-on-the-server.md` item 5). D121 item 4 keeps names out of the competence search's address. Its test "no name in the address" is in `apps/web/tests/competence-address.test.ts`.

**Scenario.**

1. A manager opens Anna Svensson's talk.
2. The access log of the web container now holds `GET /api/cap/clew.commitments?input=%7B%22person%22%3A%22anna.svensson%22%7D` with the manager's IP address and time.
3. Typing `@Bertil` in the composer adds `GET /api/objects?q=B`, `…?q=Be`, … `…?q=Bertil`.

Container logs are commonly shipped to a central log store with a longer retention and a wider audience than Clew's own audit. A person's searches and the people whose talks a manager opened are personal data there, outside every rule Clew applies.

The tool page writes the search into its address on purpose: "a search is addressable" (`tool.tsx:283`), under D116. The conflict is with the reason given in D100 item 5 and D121, and it needs a decision on which rule wins for a free-text search. The identity review's hand-over raised `GET /api/cap/:name` under "Seen outside" (`apps/server/src/routes/capabilities.ts:51`). It was not reported as a finding in wave 1, so it is reported here.

**How established.** By reading the call sites, `nginx.conf.template`, and the server's span rule.

**Severity.** Medium. It is a personal-data leak into operator logs and browser history, which this review weighs highest, but it reaches only those who run the installation.

### Low

#### L1 · Alla samtal shows at most 50 conversations, shared with recently handled work items, ordered by when they began

`packages/db/src/threads.ts:116-138`; the memory adapter does the same (`apps/server/src/threads/adapters/memory.ts:191-207`). Also `apps/web/src/pages/conversations.tsx:68-74`.

`listThreads` returns every unresolved work item, plus one history query with `limit(50)` ordered by `createdAt` descending. The history query covers:

- every open conversation;
- every handled item updated in the last seven days.

Alla samtal draws the conversations from that same list (`threadsQuery`, then `groupThreads(...).questions`).

So a person who has had more than about 50 conversations, fewer in a week with many handled items, does not see the older ones. Because the order is by `createdAt`, a conversation begun long ago and continued today is among those dropped.

The status page says "Alla samtal (`/conversations` …) lists every conversation newest first" (`docs/reference/status/interface.md:47`). The conversations stay reachable by their address, but nothing in the interface leads to them.

**How established.** Unit probe on the memory store with 60 conversations: `F: conversations stored 60, listed 50 shown in Alla samtal 50`. The `createdAt` ordering was established by reading.

**Severity.** Low. It is a functional gap and a false status claim, and it appears only with use.

#### L2 · Toasts and the tab's title outlive the end of the session

`apps/web/src/main.tsx:486` (`Providers`, which holds Astryx's `LayerProvider` and so the toast stack, sits above the router and `SessionBoundary` at `:200`); `apps/web/src/page-title.ts:7`.

When the session ends, the boundary replaces the page with the ended card and conceals nothing else. These stay on screen with their buttons live:

- toasts that do not hide by themselves: "Avfärdad som inte aktuellt …" with Ångra (`mutations.ts:247`), the receipt notice (`card.tsx:110`), Att göra's own notice (`todo.tsx:218`) and error toasts;
- the tab's title, which keeps the last page's name.

A toast can carry a work item's title, and a work item's title can name a person. Pressing Ångra after the end sends a request that answers 401 and ends the session again.

**How established.** Playwright probe. After a dismissal, `clew-session-ended` was dispatched, then:

```
D: after the end, toast: Avfärdad som inte aktuellt. Personalsystemet skapar inte ärendet igen. Ärendet ligger under Klart. | title before: Att göra · Startsidan | after: Att göra · Startsidan
```

The toast and its Ångra button were still visible eight seconds after the ended card appeared.

**Severity.** Low. It is a small leak of what the person was doing onto an ended screen, and a live button that cannot work.

#### L3 · A turn the page reports as stopped or failed may already have written, and a retry then asks twice

`apps/server/src/assistant/index.ts:235-246` and `:825`, with the commit at `:891`; `apps/web/src/api.ts:177-240`; `apps/web/src/components/conversation/conversation-context.tsx:141`, `:445-447`.

The page tells the person that a stopped or failed turn saved nothing and puts the question back in the box (`conversation-context.tsx:141`: "the turn is aborted, nothing is saved"). Two cases break that.

**The model's start tool commits during the turn.** The model's `propose` becomes a work item through `deps.start` while the turn runs (`index.ts:235-246`), before the stop check at `:825`. Stoppa after that point leaves a new work item in Att göra while the page says nothing was saved. The unit tests of a stopped turn (`tests/unit/conversation.test.ts:610`, `:627`) do not use a start tool.

**The connection breaks after the commit.** The server commits the turn (`:891`) and then sends `done`. A connection that breaks between the two makes `converseStream` throw 502 "Svaret bröts innan det var klart. Försök igen.", and the question goes back in the box although the conversation has the answer. Sending it again asks the same question a second time, and the transcript then holds it twice.

**How established.** By reading the order of the start, the stop check and the commit, and the browser's handling of a stream that ends without `done`. Not run against the model.

**Severity.** Low. The page tells the person something false about what was saved. The work item has its own audit row, so nothing goes unaudited.

#### L4 · Session storage keeps what a conversation showed across the end of the session

`apps/web/src/conversation-shown.ts:52-76`; `apps/web/src/review-session.ts:170-181` (`clearDrafts`).

`rememberShown` writes, per conversation, the items and views that stood beside it, including each view's capability, title and input, under `clew:conversation-shown:<id>` in `sessionStorage`. `clearDrafts`, which runs when the session ends (`main.tsx:185`, `:204`), removes only the `clew.review.` prefix.

A view's input can be `{"person":"<user name>"}` or a typed search (M4), and stays readable in that tab after sign-out. D33 item 1 says "nothing in browser storage". D73 made the review draft the one exception, and `review-session.test.ts` asserts "the end of the session takes every draft, and nothing else in the tab".

**How established.** By reading.

**Severity.** Low. It applies to the same tab only.

#### L5 · A question to another system's assistant can pull the person back, or put one conversation under another's address

`apps/web/src/components/conversation/conversation-context.tsx:863-912`.

`askAside` calls `converseStream` with no `AbortController`, so there is no Stop for it, and leaving does not abort it (`openConversation` aborts only the main turn, `:700`).

When the answer arrives, `askAside` always calls `setConversation(conversationOf(response.thread))`, and it calls `onConversation(response.conversationId)` when the question started a new conversation. That has two effects:

- A person who asked from `/conversations/new` and went on to Att göra is navigated back to the conversation when the answer comes.
- A person who asked beside conversation A and then opened conversation B from Alla samtal gets A's transcript under B's address. The route effect re-reads only when the address changes (`:718-729`), so A stays drawn there.

The comment at `:730` promises the opposite for the main turn: "nothing pulls the person back".

**How established.** By reading.

**Severity.** Low. A focus and orientation problem (2.4.3 and 3.2.2 adjacent) that depends on a slow outside assistant.

#### L6 · The open conversation is a copy in component state that no notice refreshes

`apps/web/src/components/conversation/conversation-context.tsx:328`, `:698-713`.

The conversation on the page is `useState<Conversation | null>`, filled once from `client.query(threadQuery(id))` when the address names a new id. A change notice invalidates the thread query, but nothing reads it back into the state.

A turn asked in a second tab, or an answer written by another system's assistant, therefore appears only after the person leaves the conversation and opens it again. D33 item 2 says a screen "never keeps server data in `useState`".

**How established.** By reading.

**Severity.** Low.

#### L7 · A refused prediction is not taken back from the list once another card's answer has landed

`apps/web/src/thread-cache.ts:61-62`.

`previewThread` restores the list only if the list's `dataUpdatedAt` is still the one the preview wrote. If any other write lands on the list in between, the refused card stays drawn as dismissed or snoozed, though its single entry is restored. Such writes include another card's answer, a stream notice's refetch and another preview.

**Scenario.** The person presses Avfärda on two cards in quick succession. The second is answered first. The first is refused (for example, the source said no) and the error toast says why, but the card stays out of the list until a later notice or refocus re-reads it.

**How established.** Unit probe:

```
G: list after a was refused: [["a","dismissed"],["b","dismissed"]] | single entry a: undefined
```

Card a was refused after card b's answer landed. The list still showed a as dismissed.

**Severity.** Low. It corrects itself at the next read, but the screen contradicts the error toast in the meantime.

#### L8 · Two reads poll, against D33 and D46

- `apps/web/src/components/work/review-recovery.tsx:33`: a correction's status is read every 1.5 s while it is `pending` or `running`, with no upper bound. A source that never answers is polled for as long as the page is open.
- `apps/web/src/pages/admin/competence-sources.tsx:245-249`: a competence source's import is read every 2 s for up to ten minutes.

D33 item 4 says "nothing polls", and D46 says "The browser does not poll". Neither poll is listed as an exception. The correction's state is a committed execution, which the change stream could announce like any other.

**How established.** By reading.

**Severity.** Low.

#### L9 · The first load asks for the session twice, in a chain, before the page's first read

`apps/web/src/main.tsx:82-119` and `:495`; `packages/ui/src/session.tsx:62`, `:166`.

The first load runs these requests in order:

1. `loadBranding()` reads `/api/appearance` before anything renders.
2. `Protected` reads `/api/header` and `/api/auth/session` in parallel, then waits for the header.
3. `SessionBoundary` starts in `'checking'` and reads `/api/auth/session` again, showing "Kontrollerar inloggning…" between the first-load frame and the page.
4. Only then do the page's reads leave.

**How established.** Playwright probe:

```
E: requests up to the first page read: ["/api/appearance","/api/header","/api/auth/session","/api/auth/session","/api/changes","/api/threads"]
```

**Severity.** Low. Two extra round trips, and one extra frame with a status message on every load.

## The questions, answered

**1. Mutations and predictions.**

- Double presses are held off: `useThreadAction` keeps an in-flight guard, `perform` returns while `busy` (`card.tsx:473`), and dialogs load.
- Rollback is correct for the single entry but not for the list once another write has landed (L7).
- Decision ids made in the browser exist in three places.
  - The booking and event dialogs make a UUID per opening and reuse it for a retry within the dialog (`booking-dialog.tsx:56`, `:70`; `event-dialog.tsx:61`, `:67`), so a retry after a lost answer is the same decision.
  - A correction's id is the SHA-256 of its operation and payload (`review-recovery.tsx:68-74`), so the same correction after a failure carries the same id. That is the same shape as the decisions review's M1 and is not reported again.
  - A work item's decision id is made on the server from the thread's `updatedAt` (`apps/server/src/threads/usecases/decisions.ts:152`).
- Success can be drawn as failure for a conversation turn (L3). For a work item's decision it cannot be drawn as success, since nothing is predicted for it (D45, `card.tsx:493`).
- What is left pending when the person leaves keeps running, because the cache outlives route changes. The answer lands in the cache and the toast says it. The exception is the aside question, which pulls the person back (L5).

**2. The cache.**

- After a decision, an undo or a dismissal, `applyThread` writes the thread and the list and re-reads areas, attention and, with proposals, the loaded weeks.
- An admin write invalidates `['admin']` only (`useAdminAction`). The menu, the views and the header (`staleTime: Infinity`) wait for the change stream, which the decisions review's L10 shows misses several tables. This is that finding's consequence, not a new one.
- No key was found missing a parameter that its read depends on. Two keys are written inline instead of in `query-keys.ts` (`['correction', operation]` and `['review-source', …]` in `review-recovery.tsx:30`, `:36`), against D33 item 2's wording but harmless.
- One person's data does not survive into another's session through the cache:
  - the client is per `Protected` and cleared on every end;
  - a 401 anywhere dispatches the end;
  - the back/forward cache is concealed and re-checked (`session.tsx:138-143`).
- What does survive is outside the cache (L2, L4).

**3. The change stream.**

- Missed events are covered: a reconnect starts with the current revision, and `changeNotices` compares it with the last one seen (`thread-cache.ts:93-98`).
- A sleeping tab closes its stream and catches up when shown.
- Two tabs each have their own stream and cache. That is correct, at a cost (below).
- An event that arrives before the mutation's response waits for it (`held`, `thread-cache.ts:99`; tested in `tests/unit/web-thread-cache.test.ts`).
- What fails is reconnecting after an HTTP error (M2).

**4. A conversation's stream.**

- Stop aborts the request and the server checks before it commits (L3 covers the two gaps).
- Text taken back (`event.reset`) replaces what was drawn.
- A message drawn twice comes from a retry after a lost `done` (L3).
- A second tab sees a stale copy (L6).
- The thread cache is written with `applyThread` when the turn is done.

**5. Errors.**

- Messages are Swedish throughout: `errorMessage` shows the server's text or a Swedish fallback, and a non-JSON answer (an nginx error page) becomes "Tjänsten svarade oväntat." (`api.ts:163-167`).
- `call()` trusts the answer's shape (`return data as T`). With a same-origin, typed server that is acceptable, and it was not counted as a finding.
- 401 ends the session by design.
- 403 and 404 are "refused" or "hidden" (`query-policy.ts:29-33`).
- 409 shows the server's sentence.
- A 5xx read is retried once.
- 503 and offline on the session check end the session (M1).
- A mutation that fails offline shows its fallback sentence ("Frågan kunde inte ställas.") without saying the network is down. That is acceptable once M1 is fixed.
- Logout failure is reported and retried (`shell.spec.ts` asserts it).
- Nothing in `apps/web/src` swallows an error silently.

**6. Addresses.**

- Reload, back and forward read the address everywhere checked. The conversation route re-reads on a changed id (`conversation-context.tsx:718-729`).
- A deep link to a hidden thing gets the route's 404 and is drawn as "hidden".
- A signed-out deep link loses its query (M3).
- User names and typed text appear in queries (M4).
- The ways back (`from`) are confined to Clew's own paths, and the address helpers' tests assert it (`item-address.test.ts`, `entity-address.test.ts`).
- The one redirect built in the browser is sign-in's `returnTo` (M3; the identity review's finding 2).

**7. What the browser holds.**

- No token or credential is stored: the CSRF token lives in memory (`session.tsx:72`).
- `localStorage` holds the appearance's colours only.
- No source maps ship: `vite.config.ts` sets none, and the built output held no `.map` file.
- There is no `dangerouslySetInnerHTML` and no `console.*` in `apps/web/src`.
- `window.open` passes `noopener` (`card.tsx:486`), and the link-field schemes are the connector review's finding 8.
- No `postMessage` is used, apart from the BroadcastChannel of the session.
- `sessionStorage` holds the review drafts (D73) and, against D33, what a conversation showed (L4).

**8. Loading.**

- The first load is a chain (L9).
- Two reads poll (L8).
- The thread list returns all unresolved work by design ("History can never displace work"), and caps history (L1).
- The stream and its listeners are removed on unmount.
- The `remind` timer in `card.tsx:636` is never cleared. It only invalidates the stream once, so it is harmless.
- `handledToday` in `stream.ts` is unused.

**9. Tests.** What is asserted:

- the address helpers;
- `thread-cache` (in-place writes, cancelled refetches, held notices, repeated revisions, logged reads);
- predictions and their holds;
- the retry policy and its messages;
- the receipt moment and the delivery toast;
- review drafts and their clearing.

The accessibility harness asserts:

- a refused prediction coming back (`optimistic.spec.ts`);
- notices, reconnects and two tabs through a test `EventSource` (`reliability.spec.ts`);
- a policy change (`executions.spec.ts:163`);
- Stoppa (`answer.spec.ts`).

What nothing asserts:

- **The session boundary's reaction to a non-401 failure.** No test answers `/api/auth/session` with 503 or a network error (M1).
- **The real `EventSource`'s error path.** The harness answers `/changes` with an empty `retry: 60000` stream (`tests/a11y/support.ts:596-597`), and `reliability.spec.ts` replaces `EventSource` with a class that never errors (M2).
- **`returnTo` with a query, and the ended card's link** (M3).
- **What stays on screen after the end** (L2).
- **A turn stopped after a start tool, or a stream lost after the commit** (L3).
- **The 50-row history cap against Alla samtal** (L1).
- **`conversation-shown` at the end of a session** (L4).

## Follow-ups from wave 1

### What a content security policy for this app has to allow

The identity review's finding 4 and the assistant review's finding 1 will add the header. Reading `packages/ui/src/document.tsx`, `apps/server/src/routes/protocol.ts` and the production bundle that the probe built gives these directives for nginx's `location /`. The reason for each is listed under the block.

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
worker-src 'self';
frame-src 'self';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none'
```

**Scripts: `'self'` is enough.**

- `index.html` has no inline script; its module script and stylesheet are both under `/assets`.
- No application chunk contains `eval(` or `new Function`.
- Vite's preload helper reads a nonce from `meta[property=csp-nonce]` only if one is there.

**Styles: `'unsafe-inline'` is the floor while Astryx takes no nonce.** These write `<style>` elements at runtime:

- Astryx's theme and prose theme, appended to `document.head`;
- Astryx's layer rules (`astryx-layer-slide-rules`);
- React 19's hoisted styles;
- pdf.js's font styles.

Astryx 0.7.16 has no nonce option, and the theme's text comes from the database (D98), so a build-time hash cannot cover it. Three kinds of styling are not governed by `style-src` and need nothing:

- Astryx's constructable stylesheet for the text scale;
- `insertRule` for code highlighting;
- React's `style` prop, which goes through the CSSOM.

FullCalendar 7's `skeleton.css` and `calendar-theme.css` are static imports that end up in the built stylesheet, so FullCalendar needs nothing beyond `'self'`.

**Fonts.**

- The Raleway files are self-hosted under `/assets`.
- pdf.js may load a document's embedded fonts from `data:`.

**Images.**

- `blob:` for an image preview (`document.tsx:54`).
- `data:` for docx-preview (`useBase64URL: true`) and pdf.js.
- The logo is on Clew's own origin (D98).
- Leaving `https:` out is what stops an answer's Markdown from loading images from anywhere (the assistant review's finding 1).

**Workers.**

- The pdf.js worker is a same-origin `/assets/pdf.worker.min-*.mjs` (`document.tsx:88-90`).
- The workbook worker is `new Worker(new URL('./workbook.worker.ts', …))` (`document.tsx:318`).
- Both are `'self'`.

A dedicated worker takes its policy from its own response. If nginx sends the header on `/assets` too:

- pdf.js's feature test of `new Function` is refused. It falls back, but logs a violation; passing `isEvalSupported: false` to `getDocument` (`document.tsx:91`) avoids that.
- Its WebAssembly image decoders need `'wasm-unsafe-eval'` in that policy. `wasmUrl` is not set at `document.tsx:91`, so whether they load at all today was not established.

**The document preview frame** is an `iframe` with `srcDoc`, `sandbox="allow-same-origin"` and its own meta policy (`document.tsx:228`, `:296-301`). A `srcdoc` document inherits the embedding page's policy in addition to its own. The page's policy must therefore still allow what docx-preview writes into the frame: `<style>` elements and `data:` images, both covered above. `frame-src` is not consulted for `about:srcdoc`; that was not tried in a browser.

**connect-src.** Every request is same-origin: `sessionFetch` refuses any other origin (`session.tsx:16`), and the change stream is `/api/changes`.

**`form-action`.** Not established whether a sign-in form posts to the identity provider in some configuration. If one does, its origin must be added.

**The Scalar page** is served by the BFF at `/api/protocol/` (`protocol.ts:26-49`), outside nginx's `location /`, so a header added there never reaches it. It has:

- an inline script, which needs a hash or a move to a file;
- the same-origin `/api/protocol/scalar.js`;
- Scalar's own runtime `<style>` elements;
- `withDefaultFonts: false`, which keeps fonts local.

Whether Scalar's standalone bundle needs `eval` was not established.

**Where to set it.** nginx's `add_header` in a `location` replaces every inherited `add_header`, and `location /` already has one (`Cache-Control`). The policy therefore has to be repeated in every location that sets a header of its own, with `always`.

### What the browser could send with a decision to bind it to what was shown

**What it sends today.** The browser sends `actionId`, `refs`, `reviews` and `values` (`api.ts:530-534`) and nothing of the version it drew. The server names the decision `card:<id>:<action>:<updatedAt>` from the thread as the server reads it at that moment (`decisions.ts:152`). That is what the assistant review's finding 4 and the decisions review's M9 describe.

**Where the browser has the value.**

- **`thread.updatedAt`** is on the `thread` object at every call site: `card.tsx:425`, `:484`, `:497` and `conversation.tsx:119`. It is the server's value: a D64 prediction never changes `updatedAt` (`optimistic.ts` does not touch it).
- **The action dialog's "Det här händer"** is read with `thread.updatedAt` in its key (`queries.ts:38`, used at `action-dialog.tsx:213`). The effect the person read belongs to exactly that version.
- **Each row's `revision`** (`packages/contracts/src/index.ts:3534`) is on `thread.items`.
- **A reviewed decision** already carries a server-signed `ReviewEvidence` with the record's and every document's revision (`packages/contracts/src/presentation.ts:50-56`). That is the pattern to follow.

**What to send.** The smallest binding is `shown: thread.updatedAt` in the act request. The server answers 409 when it differs from `t.updatedAt`, and the decision id it already makes then names the version shown. For a dialog the request can add the refs' revisions, or a digest of the effect preview it showed.

The calendar's writes already do this: `rescheduleEvent` and `cancelEvent` send `revision: event.revision` (`event-dialog.tsx:121`, `:128`).

### The change stream authenticating every two seconds per open tab

**What one tick costs.** Each visible tab holds its own `EventSource`; hidden tabs close it (`main.tsx:126-128`). Every two seconds the server's loop runs `authenticate(cookie)` (`apps/server/src/auth.ts:377-417`) and then `changesFor` (`apps/server/src/composition/changes.ts:5-11`). That is about seven statements per tick:

| Read | Statements |
| --- | --- |
| `readSession` | 1 |
| `resolveSubject`: the identity binding, then `readAccess` | 1 + at least 2 |
| `readGroups` | 1 |
| `changesFor`: the person's and the installation's revision, in parallel | 2 |

The identity provider is not called: `refresher.refresh` returns at once unless the token is within its window (`apps/server/src/auth-refresh.ts:195`).

**What it adds up to.**

- About 210 statements a minute per visible tab.
- About 3,500 a second for 1,000 people with one tab in front of them.
- Per tab, on top of that:
  - the session boundary's poll every 15 s, which hidden tabs keep running at the browser's throttled rate and which authenticates again;
  - the activity post every 30 s while the person works;
  - `refreshConnectors()`, which runs on every `/api` request, the stream's opening included (`apps/server/src/routes/api.ts:183-187`).

**Cheaper shapes.**

- **Check less per tick.** Authenticate fully once per connection and on a longer interval (the session poll already runs every 15 s), and read only the session row and `changesFor` per tick. A revoked or expired session is the session row, which each tick still reads. A change to the person's access changes the policy revision that `changesFor` returns, and a new policy revision clears the browser's state and re-reads the session (`main.tsx:145-151`).
- **Push instead of polling.** One PostgreSQL `LISTEN` per process on the change tables, fanned out to that person's open streams, replaces the per-tab loop entirely.

Either shape keeps D46's rule that explicit denial ends the session: the denial still arrives as a policy change or at the next full check.

Not established: how far apart the full checks may be under D121's sign-in rule ("a sign-in follows the identity provider's session"). That decision would set the bound.

## Not established

- **Whether nginx's access log is kept in a real installation.** The unprivileged nginx image logs to standard output by default. Whether that is shipped and kept is the operator's choice (M4).
- **How a real browser's `EventSource` behaves when the machine sleeps and wakes.** Probe B used a fulfilled 503, not a sleeping laptop.
- **Whether pdf.js's WebAssembly decoders load today without `wasmUrl`**, and whether Scalar's bundle needs `eval` (the CSP follow-up).
- **Whether a sign-in form posts to the identity provider in any configuration** (`form-action`).
- **L3 was not run against a model.** The order of start, stop check and commit was read, not exercised.

## Looked at and found sound

- **`applyThread` and `previewThread`.** They cancel a refetch in flight before writing, so an older answer cannot land afterwards. A preview is taken back only where it still stands, and an answer that landed on top of it stays (both tested).
- **`changeNotices`.** It holds a notice while a mutation is in flight, ignores the first and repeated revisions, and never refetches documents, previews or reads the server logs (D121 item 5).
- **A policy change** cancels and clears the cache and re-reads the session (`main.tsx:144-168`; tested in `executions.spec.ts`).
- **Sign-out.** It lets the logout reply finish before the end is dispatched (`session.tsx:26-40`), and logout failure is reported.
- **The back/forward cache.** A page shown again from it is concealed until the session is re-checked (`session.tsx:138-143`).
- **Review drafts** are cleared at every end (`review-session.ts`, tested).
- **The calendar dialogs' decision ids.** They are per opening and reused for a retry; a reopened dialog is a new decision.
- **Errors.** Every message shown is Swedish. Non-JSON answers are caught. A 4xx is never retried and a mutation never is.
- **No credential, token or identity in browser storage or in the bundle.** No source maps, no `dangerouslySetInnerHTML`, no `console.*` in `apps/web/src`. `_blank` links carry `rel` and `window.open` passes `noopener`.
- **nginx.** It proxies `/api/` without buffering for the streams, and serves `index.html` with `Cache-Control: no-cache`.
- **The work list returns all unresolved work**, so history can never push work out of view.

## Seen outside this area

- **Talks recognised by title.** `packages/ui/src/agenda-items.ts:69` and `:84` decide that a calendar event is a booked talk when its title starts with "Utvecklingssamtal" (`SAMTAL`, `:26`). Any event a person names that way in their own calendar is drawn as a booked talk. This goes against D132 ("Clew owns the fact, never infers it from another system's data") and D133, which identifies a talk's meeting by the event's id. The decisions review's hand-over passed this to the web review. It is a talks rule (sessions 6 and 7) and was verified here by reading.
- **`console.error` in the site header.** `packages/site-header/src/embed.tsx:127`, `:142`, `:167` and `:223` call `console.error` in the browser. That is not under D91's server rule, but it prints source errors to the console of every page with the header.
- **"Startsidan" is hard-coded as the product's name.** It appears in the ended card's heading (`packages/ui/src/session.tsx:188`), in every tab title (`apps/web/src/page-title.ts:7`) and in `apps/web/index.html:7`, while the installation's name and logo are otherwise its own (D98). This is for the composition review or the product owner.
