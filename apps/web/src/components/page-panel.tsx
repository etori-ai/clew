import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, Thread, ViewRef } from '@clew/contracts';
import { Button, HStack, Text, VStack, type AgendaItem } from '@clew/ui';
import { areasQuery, threadsQuery, viewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { pageLocation } from '../page-location';
import { panelOf, viewSearch, withoutPanel, type PanelRef } from '../panel-address';
import { openedAsPage, opensAsPage, viewOpenHref, viewPageHref } from '../view-address';
import { cardBody } from './card-panel';
import { PanelBody, answersWithRowsOf, usePanel, type PanelFrame } from './panel';
import { Unfold } from './unfold';
import type { ThingSubject } from './conversation-context';

/** A work item as what the box beside it asks about (D112 item 7): its chip, and its card beside the conversation's page. */
export const itemSubject = (thread: Pick<Thread, 'id' | 'title'>): ThingSubject => ({
  key: 'thread:' + thread.id,
  label: 'ärendet',
  chips: [{ ref: 'thread:' + thread.id, kind: 'thread', label: thread.title, threadId: thread.id }],
  search: '?card=' + encodeURIComponent(thread.id),
});
/**
 * A view as what the box beside it asks about: its capability as the chip, and one thing beside the conversation's page.
 * A list or a table is a page of its own (D116), never beside the conversation: the conversation about it continues
 * with the chip alone (`page`).
 */
export const viewSubject = (
  view: {
    capability: string;
    title: string;
    input: Record<string, unknown>;
  },
  page = false,
): ThingSubject => ({
  // A search typed in the view refines the same view: the conversation about it goes on.
  key: `view:${view.capability}`,
  label: view.title.toLocaleLowerCase('sv-SE'),
  chips: [{ ref: 'capability:' + view.capability, kind: 'capability', label: view.title }],
  search: page ? '' : viewSearch(view),
});
/**
 * A thing a page holds in the panel itself (D112 items 7 and 9): Kalender's event or proposal (`entry` in the address),
 * or the page asked about with "Fråga Clew" (`ask=1`). The page draws it; the panel gives it the header, the box and the
 * conversation like any other thing.
 */
export interface OwnThing {
  /** Names the thing for the focus rule: another thing taking this one's place is said aloud and gets the focus. */
  id: string;
  title: string;
  subtitle?: string;
  /** What the box asks about; absent, the panel is the thing alone. */
  subject?: ThingSubject;
  /** The thing's facts and buttons; `folded` while a conversation about it runs. Absent, the conversation alone. */
  body?: (inline: boolean, folded: boolean) => ReactNode;
}

const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** A declared view on screen (D38): what it answered, and the address and input it answered for. */
export interface ShownView {
  capability: string;
  title: string;
  output: unknown;
  spec: PanelViewSpec | undefined;
  source: string | undefined;
  input: Record<string, unknown>;
  address: string;
}

/**
 * One view read for an address, a tool's page or the panel's. What is on screen stays until the next answer has
 * arrived: typing in a view's own field keeps its rows, and a view that takes another's place does so with its title,
 * in one step, so the panel stays open between a row and its contact card and focus can follow.
 */
export function useView(capability: string | null, inputJson: string | null, at: { title: string; address: string }) {
  const query = useQuery({
    ...viewQuery(capability ?? '', inputJson),
    enabled: !!capability,
    placeholderData: keepPreviousData,
  });
  const input = useMemo(() => parse(inputJson), [inputJson]);
  const shown = useRef<ShownView | null>(null);
  const arrived =
    query.data && (!query.isPlaceholderData || query.data.view?.capability === capability) ? query.data : undefined;
  if (!capability || query.isError) shown.current = null;
  else if (arrived)
    shown.current = {
      capability,
      title: at.title,
      output: arrived.output,
      spec: arrived.view,
      source: arrived.source,
      input,
      address: at.address,
    };
  return {
    shown: capability ? shown.current : null,
    isLoading: query.isFetching && query.isPlaceholderData,
    failed: query.isError ? query.error : null,
    retry: () => {
      void query.refetch();
    },
  };
}

/** What differs from page to page; everything else about the panel is the same on every page. */
export interface PagePanelOptions {
  /** Nothing pinned beside the page: a short screen (1.4.10), or a page that never has the panel beside it. */
  overlayOnly?: boolean;
  /** The drawer over the page has closed (`usePanel`): where the page sends the focus when its opener is gone. */
  onClosed?: () => void;
  /**
   * Where a view's read that failed is said. `panel`: in the panel, in the view's place, and while the view is on its
   * way what was on screen stays. `page`: the page says it in its own alert (`failure`), and the panel draws only what
   * has arrived. Hem and a tool's page say it themselves, as they did before the panel was one hook. A card's read says
   * its own failure inside the card (`card-read.tsx`).
   */
  failures?: 'panel' | 'page';
  /** A card's own button changed it: told before the cache is written (`mutations.ts`), so the page can move focus first. */
  onChange?: (thread: Thread) => void;
  /** An entry in a day view (D32) was chosen: the page opens its dialog over the panel. */
  onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void;
  /** The page itself as the thing, when "Fråga Clew" is pressed in its header (`ask=1`, D112 item 7). */
  pageThing?: OwnThing | null;
  /** The thing the page holds open in the panel by its own address (`entry`: Kalender's event or proposal, D112 item 9). */
  entry?: OwnThing | null;
  /** Whether a thing gets the box under it; false on a conversation's own page (`usePanel`'s `asks`). */
  asks?: boolean;
}
export interface PagePanelSlot {
  /** The panel beside the page, for the page's `Layout end`; undefined where it is drawn over the page. */
  end: ReactNode | undefined;
  /** The drawer over the page, rendered by the page wherever the panel does not stand beside it. */
  overlay: ReactNode;
  /** Whether the panel takes width beside the page: something is open in it, or the person is looking at it empty. */
  occupied: boolean;
  /** Whether the panel stands beside the page (non-modal) rather than over it. */
  inline: boolean;
  /** What the panel draws now. */
  frame: PanelFrame | null;
  /** What the address opens in the panel, whether or not it has arrived. */
  ref: PanelRef | null;
  /** The card the panel draws now, when it draws one. */
  card: Thread | null;
  /** The view on screen, or a card's read drawn in the card's place, which names the page in the browser tab. */
  view: { title: string } | null;
  /** A view's read the address asked for that failed, for a page that says it itself (`failures: 'page'`). */
  failure: { message: string; retry: () => void } | null;
}

/**
 * The panel of a page (D50, D83 rule 1; the product owner, 2026-11-11: where something opens is decided by what it is,
 * never by the page it was clicked on). The address names what the panel holds the same way on every page
 * (`panel-address.ts`): `open` is a view and `card` is a card; the panel holds one opened thing, to peek at (D116, the
 * product owner, 2026-11-12: "The sidebar needs to be for peeking or some kind of instant actions, otherwise a full
 * route is needed"). A view that answers with rows is never drawn here: an address that opens one beside the page (a
 * saved link from before, a read whose kind was not known) is replaced by the view's own page. A record or a document
 * links to its page from the panel's header. The card is drawn as Hem draws it, from the same cache (D33), so a
 * decision made beside any page is the decision made on Hem, and one of its own reads unfolds inside it (`open-card`
 * with `open-action`, `card-read.tsx`). Closing lets go of the top layer only: the view leaves the card, the card
 * leaves the page. What differs per page comes in as options, and the panel itself is `usePanel`, which decides from
 * the one width `BESIDE_FROM` whether it stands beside the page or over it.
 */
function usePanelOnPage({
  overlayOnly = false,
  onClosed,
  failures = 'panel',
  onChange,
  onOpenItem,
  pageThing,
  entry,
  asks = true,
}: PagePanelOptions): PagePanelSlot {
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;
  const address = pathname + location.search;
  const ref = panelOf(search);
  const viewRef = ref?.kind === 'view' ? ref : null;
  /** The card the address names: in the panel unless a view lies over it. */
  const cardId = search.get('card') ?? undefined;
  const views = useQuery(areasQuery).data?.views;
  // A view the person's reads say is a list or a table is not read here at all; any other is read, and sent on to its
  // page below if it answers with rows after all.
  const listed = !!viewRef && opensAsPage(views, viewRef.capability);
  const side = useView(viewRef && !listed ? viewRef.capability : null, viewRef ? search.get('open-input') : null, {
    title: viewRef?.title ?? '',
    address,
  });
  const threadsQ = useQuery({ ...threadsQuery, enabled: !!cardId });
  const threads = threadsQ.data?.threads;
  const thread = cardId ? threads?.find(t => t.id === cardId) : undefined;
  // A view that answered with rows is a page (D116): the address that opened it beside this page is replaced by the
  // view's page, with this page as its way back, so Back leads to where the person was before they opened it.
  const rows = listed || (!!side.shown && answersWithRowsOf(side.shown.spec, side.shown.output));
  const page = rows ? openedAsPage(pathname, search) : null;
  useLayoutEffect(() => {
    if (page) navigate(page, { replace: true });
  }, [page]);
  const changed = useRef(onChange);
  changed.current = onChange;
  const changedCard = useCallback((t: Thread) => changed.current?.(t), []);
  const held = useRef<{ frame: PanelFrame; card: Thread | null; view: { title: string } | null } | null>(null);

  const close = () => {
    // Use the current address, which another surface can have changed since this one was drawn, so dismissing the
    // card keeps it.
    const current = pageLocation();
    navigate(withoutPanel(current.pathname, current.search));
  };
  /** Where a row of the thing in the panel leads (a record's line that opens a read): a list to its page, one thing in its place. */
  const hrefFor = (v: ViewRef) => viewOpenHref(views, pathname, search, v);
  const failed = (
    id: string,
    title: string,
    message: string,
    retry: { isFetching: boolean; refetch: () => unknown },
    kind?: 'card',
  ): PanelFrame => ({
    id,
    title,
    ...(kind ? { kind } : {}),
    onClose: close,
    body: () => (
      <VStack gap={3}>
        <Text as="p">{message}</Text>
        <HStack>
          <Button
            size="sm"
            variant="secondary"
            label="Försök igen"
            isLoading={retry.isFetching}
            onClick={() => void retry.refetch()}
          />
        </HStack>
      </VStack>
    ),
  });

  const pageSays = failures === 'page';
  let frame: PanelFrame | null = null;
  let card: Thread | null = null;
  let view: { title: string } | null = null;
  if (viewRef) {
    const shown = rows ? null : side.shown;
    if (shown) {
      view = shown;
      // A record or a document is one thing too large to read beside a page alone: its own page is a link in the
      // panel's header, worded as a work item's link to its page (D116). A record is its view's page with its input.
      const whole = shown.spec?.kind === 'record' || shown.spec?.kind === 'document';
      frame = {
        // Named by the view on screen, not by the one on its way: focus follows a view when its rows are there to land on.
        id: `view:${shown.capability}`,
        title: shown.title,
        address: shown.address,
        ...(whole
          ? {
              page: viewPageHref(
                { capability: shown.capability, title: shown.title, input: shown.input },
                pathname + location.search,
              ),
            }
          : {}),
        onClose: close,
        // What the box beside it asks about: the view, by its capability (D112 item 7).
        subject: viewSubject({ capability: shown.capability, title: shown.title, input: shown.input }),
        // A view has no buttons of its own to keep: while a conversation about it runs, the whole view is behind "Visa allt".
        body: (inline, folded) => (
          <Unfold folded={folded}>
            <PanelBody
              output={shown.output}
              view={shown.spec}
              source={shown.source}
              input={shown.input}
              inline={inline}
              isLoading={side.isLoading}
              onOpenItem={onOpenItem}
              hrefFor={hrefFor}
            />
          </Unfold>
        ),
      };
    } else if (side.failed && !pageSays)
      frame = failed(`view:${viewRef.capability}`, viewRef.title, errorMessage(side.failed, 'Kunde inte hämta.'), {
        isFetching: false,
        refetch: side.retry,
      });
  }
  if (!frame && cardId && (!pageSays || ref?.kind === 'card')) {
    if (thread) {
      card = thread;
      frame = {
        id: `card:${thread.id}`,
        kind: 'card',
        title: 'Ärende',
        // Another item taking this one's place is said by its own title: the heading says only "Ärende".
        spoken: thread.title,
        address,
        onClose: close,
        subject: itemSubject(thread),
        // The item's buttons, Inte nu among them, are the item's own (D112 item 4): the header holds the small title and ✕.
        // While a conversation about it runs, its main column folds under "Visa allt" and the buttons stay (item 7).
        body: (_inline, folded) =>
          cardBody(thread, { place: 'panel', compact: true, level: 3, onChange: changedCard, folded }),
      };
    }
    // The stream did not answer, or has answered and has no such card: said in the card's place, as a person is. A page
    // that says its own failures (Hem) says the stream's in its alert; that the card is gone only the panel can say.
    else if (!pageSays && threadsQ.isError)
      frame = failed(
        `card:${cardId}`,
        'Ärende',
        errorMessage(threadsQ.error, 'Ärendet kunde inte hämtas just nu.'),
        threadsQ,
        'card',
      );
    else if ((!pageSays || ref?.kind === 'card') && threads)
      frame = {
        id: `card:${cardId}`,
        kind: 'card',
        title: 'Ärende',
        onClose: close,
        body: () => <Text as="p">Ärendet finns inte längre bland dina ärenden.</Text>,
      };
  }
  // A thing the page holds itself (D112 items 7 and 9): its calendar entry, or the page asked about with "Fråga Clew".
  const own = !frame ? (ref?.kind === 'entry' ? entry : ref?.kind === 'page' ? pageThing : null) : null;
  if (own)
    frame = {
      id: own.id,
      title: own.title,
      ...(own.subtitle ? { subtitle: own.subtitle } : {}),
      address,
      onClose: close,
      ...(own.subject ? { subject: own.subject } : {}),
      body: (inline, folded) => own.body?.(inline, folded) ?? null,
    };
  // Where the panel says what failed (`failures: 'panel'`), what was on screen stays while a view is on its way: a row's
  // view opened from a card's read takes the card's place in one step, and the card under it is not drawn, named and
  // given the focus in between. A view on its way to its own page keeps it too, until the page has taken its place.
  const onItsWay = !!viewRef && (!side.shown || rows) && !side.failed;
  if (!pageSays) {
    if (onItsWay && held.current) ({ frame, card, view } = held.current);
    else held.current = frame ? { frame, card, view } : null;
  }
  const failure =
    viewRef && side.failed ? { message: errorMessage(side.failed, 'Kunde inte hämta.'), retry: side.retry } : null;
  const slot = usePanel(frame, { overlayOnly, onClosed, asks });
  return { ...slot, frame, ref, card, view, failure };
}

/**
 * Which pages hold the panel themselves. A page that calls `usePagePanel` claims it for as long as it is mounted; the
 * shell draws the panel over any other page (`PanelOverPage`). Two contexts: the claim is stable, so a page is never
 * drawn again when another claims; only the shell's fallback hears whether the panel is claimed.
 */
const Claim = createContext<(() => () => void) | null>(null);
const Claimed = createContext<boolean | null>(null);

/** Around the pages of a session: counts the pages that hold the panel themselves. */
export function PanelClaims({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims(n => n + 1);
    return () => setClaims(n => n - 1);
  }, []);
  return (
    <Claim.Provider value={claim}>
      <Claimed.Provider value={claims > 0}>{children}</Claimed.Provider>
    </Claim.Provider>
  );
}

/**
 * The panel of a page that draws it beside its own column (Hem, a tool's page, Personal, a person's and a unit's page):
 * the page spreads `end` into its `Layout` and renders `overlay`, and the shell leaves the panel to it.
 */
export function usePagePanel(options: PagePanelOptions): PagePanelSlot {
  const claim = useContext(Claim);
  useLayoutEffect(() => claim?.(), [claim]);
  return usePanelOnPage(options);
}

/**
 * The panel over a page that has none of its own (Administration): what the address opens, a card or a view,
 * lies in the drawer over the page, and closing it leaves the page as it was. A card that is not among the person's
 * cards says so in the drawer, as it does beside any page. Decided once the page is on screen: layout effects run from
 * the shell up to the page, so by the first re-render every page that holds the panel has claimed it, and the panel is
 * never drawn twice nor a card's read asked twice. Outside a session's pages (no `PanelClaims`) it draws nothing.
 */
export function PanelOverPage() {
  const claimed = useContext(Claimed);
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => setSettled(true), []);
  return settled && claimed === false ? <Overlay /> : null;
}
function Overlay() {
  // Over the page only: Administration's pages grow with the shell's scroll and have no narrow layout to give way to
  // (D111, amended 2026-11-11).
  const slot = usePanelOnPage({ overlayOnly: true });
  return <>{slot.overlay}</>;
}
