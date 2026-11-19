import { createContext, createElement, useContext, type ReactNode } from 'react';
import { HStack, useMediaQuery } from '@clew/ui';

/**
 * What the page frame hands to the parts drawn inside it (D130 rules 1 and 11). Its own file, so the parts that read it
 * (a register's title line in `page-header.tsx`, a view's breakpoint in `view.tsx`) need not import the frame.
 */
export interface PageFrameContext {
  /**
   * "Fråga assistenten" for a page whose title line is drawn inside its content (a register's, by its view, D74): that
   * line draws it at its end. Null where the frame draws the title itself, or the page has no button.
   */
  askButton: ReactNode;
  /** The width the assistant's pane takes from the column while it stands beside it; 0 while it is closed or a drawer. */
  paneWidth: number;
}
export const PageFrameContext = createContext<PageFrameContext>({ askButton: null, paneWidth: 0 });

/** The frame's "Fråga assistenten" for a title line drawn inside the page's content (D130 rule 1). */
export const useFrameAskButton = (): ReactNode => useContext(PageFrameContext).askButton;
/**
 * The frame's "Fråga assistenten" where a page draws its head in its column and no `PageHeader` (the review on a phone):
 * after the title, as the frame puts a thing's actions under the title on a phone. Nothing where the frame draws the
 * button itself or draws none.
 */
export function FrameAskButton(): ReactNode {
  const button = useFrameAskButton();
  return button ? createElement(HStack, null, button) : null;
}

/**
 * A window query with its widths moved by `by` pixels: `(min-width: 1280px)` with 400 is `(min-width: 1680px)`. Only
 * `min-width` and `max-width` in px move; anything else in the query stays as it is.
 */
export const shiftQuery = (query: string, by: number): string =>
  by === 0
    ? query
    : query.replace(
        /\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g,
        (_, edge: string, px: string) => `(${edge}-width: ${Number(px) + by}px)`,
      );

/**
 * A breakpoint of the page's column rather than the window's (D130 rule 11): while the assistant's pane stands beside
 * the page, the column is that much narrower, so a query about it is the window's query moved by the pane's width, and a
 * table becomes its list while the pane takes its room. Astryx has no container-query hook (searched 2026-11-18), and a
 * width measured by hand would rebuild what `useMediaQuery` does; the frame knows the pane's width, so the window query
 * is enough.
 */
export function useColumnQuery(query: string): boolean {
  const { paneWidth } = useContext(PageFrameContext);
  return useMediaQuery(shiftQuery(query, paneWidth));
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
 * Whether a thing's facts stand in its column rather than in the end panel beside it (D130 rule 11, D131 item 9): where
 * the window is narrow (`query`, the page's narrow line), and whenever the assistant's pane stands beside the page, since
 * the pane then holds the end slot the facts' panel had. This is not the column's width: at 1728 px the column beside
 * the pane is still wider than the narrow line, and the facts have nowhere else to stand. The frame places its `facts`
 * by it, and a page that places its facts in its column itself (a work item's read, the review's "Hittills") asks the
 * same, so the two never disagree.
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
