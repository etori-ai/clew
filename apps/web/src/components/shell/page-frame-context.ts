import { createContext, useContext, type ReactNode } from 'react';
import { useMediaQuery } from '@clew/ui';

/**
 * What the page frame hands to the parts drawn inside it (D130 rule 11 on the branch, D133 item 4). Its own file, so the
 * parts that read it (a view's breakpoint in `view.tsx`, a work item's facts) need not import the frame.
 */
export interface PageFrameContext {
  /**
   * The width the assistant's pane takes from the page while it stands beside it, the gap to it included; 0 while it is
   * closed or a drawer.
   */
  paneWidth: number;
  /**
   * The widest the shell's column is (`SHELL_WIDTH`, D130): a page stands in it, so with the pane beside it the page
   * never gets wider than the column less the pane, however wide the window is.
   */
  columnWidth: number;
}
export const PageFrameContext = createContext<PageFrameContext>({ paneWidth: 0, columnWidth: Infinity });

/**
 * A window query with its widths moved by `by` pixels: `(min-width: 1280px)` with 400 is `(min-width: 1680px)`. Only
 * `min-width` and `max-width` in px move; anything else in the query stays as it is. Where the page stands in a column
 * no wider than `cap` (the shell's, D130), a width moved past it can never be reached by the page: a `max-width` beyond
 * it then always holds and a `min-width` beyond it never does.
 */
export const shiftQuery = (query: string, by: number, cap = Infinity): string =>
  by === 0
    ? query
    : query.replace(/\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g, (_, edge: string, px: string) => {
        const moved = Number(px) + by;
        if (edge === 'max' && moved >= cap) return '(min-width: 0px)';
        if (edge === 'min' && moved > cap) return '(max-width: 0px)';
        return `(${edge}-width: ${moved}px)`;
      });

/**
 * A breakpoint of the page's column rather than the window's (D130 rule 11 on the branch, D133 item 4): while the
 * assistant's pane stands beside the page, the page is that much narrower, so a query about it is the window's query
 * moved by the pane's width, and a table becomes its list while the pane takes its room. The page stands in the shell's
 * column, so past the column's width the window no longer widens it (`shiftQuery`'s `cap`). Astryx has no
 * container-query hook (searched 2026-11-18), and a width measured by hand would rebuild what `useMediaQuery` does; the
 * frame knows the pane's width, so the window query is enough.
 */
export function useColumnQuery(query: string): boolean {
  const { paneWidth, columnWidth } = useContext(PageFrameContext);
  return useMediaQuery(shiftQuery(query, paneWidth, columnWidth));
}

/**
 * `useColumnQuery` for a page whose own component draws its frame, and so stands outside it: the part inside the frame
 * that follows the column is drawn by `children`, told whether the query holds there (D130 rule 11). It draws nothing of
 * its own.
 */
export function InColumn({ query, children }: { query: string; children: (matches: boolean) => ReactNode }): ReactNode {
  return children(useColumnQuery(query));
}

/**
 * Whether a thing's facts stand in its column rather than in the end panel beside it (D131 item 9, D133 item 4): where
 * the window is narrow (`query`, the page's narrow line), and whenever the assistant's pane stands beside the page, as
 * the page then lays itself out as it would in a narrower window. The frame places its `facts` by it, and a page that
 * places its facts in its column itself (a work item's read, the review's "Hittills") asks the same, so the two never
 * disagree.
 */
export function useFactsInColumn(query: string): boolean {
  const { paneWidth } = useContext(PageFrameContext);
  const narrow = useMediaQuery(query);
  return narrow || paneWidth > 0;
}
/** `useFactsInColumn` for a page whose own component draws its frame, read inside the frame as `InColumn` is. */
export function FactsInColumn({
  query,
  children,
}: {
  query: string;
  children: (inColumn: boolean) => ReactNode;
}): ReactNode {
  return children(useFactsInColumn(query));
}
