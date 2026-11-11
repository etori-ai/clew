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
import { Button, HStack, Text, VStack, useMediaQuery, type AgendaItem } from '@clew/ui';
import { threadsQuery, viewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { panelOf, readOf, withView, withoutPanel, withoutRead, type PanelRef } from '../panel-address';
import { mobileQuery } from '../media';
import { cardBody } from './card-panel';
import { unfoldsInCard, useCardRead } from './card-read';
import { PanelBody, usePanel, type PanelFrame } from './panel';

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
  via: boolean;
  address: string;
}

/**
 * One view read for an address, a tool's page or the panel's. What is on screen stays until the next answer has
 * arrived: typing in a view's own field keeps its rows, and a view that takes another's place does so with its title,
 * in one step, so the panel stays open between a row and its contact card and focus can follow.
 */
export function useView(
  capability: string | null,
  inputJson: string | null,
  at: { title: string; via: boolean; address: string },
) {
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
      via: at.via,
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
  /** The way on from a done card (D70), where the page has a stream to continue in: Hem's next card. */
  next?: (thread: Thread) => { title: string; href: string } | undefined;
  /** The page draws the card the address names itself (Hem's sheet on a phone): the panel then holds no card. */
  cardElsewhere?: boolean;
  /** The card's steps full width, as in a phone's sheet. By default on a phone. */
  cardSheet?: boolean;
  /** An entry in a day view (D32) was chosen: the page opens its dialog over the panel. */
  onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void;
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
 * (`panel-address.ts`): `open` is a view and `card` is a card; the panel holds one opened thing. The card is drawn as
 * Hem draws it, from the same cache (D33), so a decision made beside any page is the decision made on Hem, and one of
 * its own reads unfolds inside it (`open-card` with `open-action`, `card-read.tsx`). A view's own row is a link to its
 * view in the same panel wherever the view is drawn, also in a card's read. Closing lets go of the top layer only: the
 * view leaves the card, the card leaves the page. What differs per page comes in as options, and the panel itself is
 * `usePanel`, which decides from the one width `BESIDE_FROM` whether it stands beside the page or over it.
 */
function usePanelOnPage({
  overlayOnly = false,
  onClosed,
  failures = 'panel',
  onChange,
  next,
  cardElsewhere = false,
  cardSheet,
  onOpenItem,
}: PagePanelOptions): PagePanelSlot {
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  const { pathname } = location;
  const address = pathname + location.search;
  const ref = panelOf(search);
  const viewRef = ref?.kind === 'view' ? ref : null;
  /** The card the address names: in the panel unless a view lies over it. */
  const cardId = search.get('card') ?? undefined;
  /** A card's read the address unfolds, in whichever card is drawn. */
  const asked = readOf(search);
  // A declared view with a search field (D38) asks again as the person types: the rows on screen stay until the next
  // ones arrive, so the panel and the field's focus stay put.
  const side = useView(viewRef?.capability ?? null, viewRef ? search.get('open-input') : null, {
    title: viewRef?.title ?? '',
    via: viewRef?.via ?? false,
    address,
  });
  const threadsQ = useQuery({ ...threadsQuery, enabled: !!cardId || !!asked });
  const threads = threadsQ.data?.threads;
  const thread = cardId ? threads?.find(t => t.id === cardId) : undefined;
  // The read the card asks for, the same request: a table is not unfolded in the card but drawn in its place here.
  const read = useCardRead(asked ? threads?.find(t => t.id === asked.threadId) : undefined, asked?.actionId ?? null);
  const table = read.action && read.shown && !unfoldsInCard(read.shown.view) ? read.shown : null;
  const changed = useRef(onChange);
  changed.current = onChange;
  const changedCard = useCallback((t: Thread) => changed.current?.(t), []);
  const held = useRef<{ frame: PanelFrame; card: Thread | null; view: { title: string } | null } | null>(null);

  const close = () => navigate(withoutPanel(pathname, search));
  /** Where a row's own view leads (`view.open`): the same page with that view in the panel, and the way back to this one. */
  const hrefFor = (v: ViewRef) => withView(pathname, search, v, true);
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
    const shown = side.shown;
    if (shown) {
      view = shown;
      frame = {
        // Named by the view on screen, not by the one on its way: focus follows a view when its rows are there to land on.
        id: `view:${shown.capability}`,
        title: shown.title,
        address: shown.address,
        wide: shown.spec?.kind === 'table',
        onClose: close,
        body: inline => (
          <PanelBody
            output={shown.output}
            view={shown.spec}
            source={shown.source}
            input={shown.input}
            inline={inline}
            isLoading={side.isLoading}
            onOpenItem={onOpenItem}
            /* A declared view (D38): its controls rewrite the address, so the view stays addressable and the back button undoes a search. */
            onInput={
              shown.capability === viewRef.capability
                ? input =>
                    navigate(
                      withView(
                        pathname,
                        search,
                        { capability: shown.capability, title: shown.title, input },
                        shown.via,
                      ),
                      { replace: true },
                    )
                : undefined
            }
            hrefFor={hrefFor}
            onBack={shown.via ? () => navigate(-1) : undefined}
          />
        ),
      };
    } else if (side.failed && !pageSays)
      frame = failed(`view:${viewRef.capability}`, viewRef.title, errorMessage(side.failed, 'Kunde inte hämta.'), {
        isFetching: false,
        refetch: side.retry,
      });
  } else if (table && read.action && asked) {
    // A card's read that answered with a table (`unfoldsInCard`): in the card's place, as every read was before, and ✕
    // folds it back into the card. The address is replaced as the card replaces it when it unfolds a read.
    view = { title: read.action.label };
    frame = {
      id: `action:${asked.threadId}:${asked.actionId}`,
      title: read.action.label,
      address,
      wide: true,
      onClose: () => navigate(withoutRead(pathname, search), { replace: true }),
      /* A card's read has no controls: its input is the card's. Its rows' own views are links, as in any view. */
      body: inline => (
        <PanelBody
          output={table.output}
          view={table.view}
          input={{}}
          inline={inline}
          isLoading={false}
          onOpenItem={onOpenItem}
          hrefFor={hrefFor}
        />
      ),
    };
  }
  if (!frame && cardId && !cardElsewhere && (!pageSays || ref?.kind === 'card')) {
    if (thread) {
      card = thread;
      frame = {
        id: `card:${thread.id}`,
        kind: 'card',
        title: 'Kort',
        // Another card taking this one's place is said by its own title: the heading says only "Kort".
        spoken: thread.title,
        address,
        onClose: close,
        // The card's buttons, Inte nu among them, are the card's own: the header holds the small title and ✕.
        body: () =>
          cardBody(thread, {
            beside: true,
            compact: true,
            level: 3,
            sheet: cardSheet ?? mobile,
            next: next?.(thread),
            onChange: changedCard,
          }),
      };
    }
    // The stream did not answer, or has answered and has no such card: said in the card's place, as a person is.
    else if (!pageSays && threadsQ.isError)
      frame = failed(
        `card:${cardId}`,
        'Kort',
        errorMessage(threadsQ.error, 'Kortet kunde inte hämtas just nu.'),
        threadsQ,
        'card',
      );
    else if (!pageSays && threads)
      frame = {
        id: `card:${cardId}`,
        kind: 'card',
        title: 'Kort',
        onClose: close,
        body: () => <Text as="p">Kortet finns inte längre bland dina kort.</Text>,
      };
  }
  // Where the panel says what failed (`failures: 'panel'`), what was on screen stays while a view is on its way, as a
  // view's rows stay while it asks again: a row's view opened from a card's read takes the card's place in one step,
  // and the card under it is not drawn, named and given the focus in between.
  const onItsWay = !!viewRef && !side.shown && !side.failed;
  if (!pageSays) {
    if (onItsWay && held.current) ({ frame, card, view } = held.current);
    else held.current = frame ? { frame, card, view } : null;
  }
  const failure =
    viewRef && side.failed ? { message: errorMessage(side.failed, 'Kunde inte hämta.'), retry: side.retry } : null;
  const slot = usePanel(frame, { overlayOnly, onClosed });
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
 * The panel over a page that has none of its own (Kalender, Administration): what the address opens, a card or a view,
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
  // Over the page only: Kalender's end slot holds its own Förslag panel, and Administration's pages grow with the
  // shell's scroll and have no narrow layout to give way to (D110, amended 2026-11-11).
  const slot = usePanelOnPage({ overlayOnly: true });
  return <>{slot.overlay}</>;
}
