import type { ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Grid } from '@astryxdesign/core/Grid';

/**
 * The measures pages share (D130, `docs/reference/layout-measures.md`), read in the running startsidan prototype. A
 * page takes them from here and from the layout components (`PageFrame`, `BoardCard`, `KeyFigure`, `StatusRow`) and sets
 * no gap, inset or size of its own, so the next page gets the same rhythm without being told.
 */

/** Between a page's sections: a register's key figures and its card. An Astryx spacing step, 24 px. */
export const SECTION_GAP = 6;
/** Between cards that stand together: a board's blocks and its columns, and key figures in their row. 20 px. */
export const CARD_GAP = 5;
/** How many key figures stand in a row at most, as the reference's row holds four. */
export const FIGURES_IN_A_ROW = 4;

/**
 * Key figures in their row: four to a row where they fit, and two on a phone as the reference has them, `CARD_GAP`
 * between them.
 */
export function FigureRow({ children }: { children: ReactNode }) {
  return (
    <Grid columns={{ minWidth: 140, max: FIGURES_IN_A_ROW }} gap={CARD_GAP}>
      {children}
    </Grid>
  );
}

/**
 * What a register's table is given (Astryx `Table`): the roomy rows the reference's register has, 65 px with a person's
 * initials in them, and the row's hover.
 */
export const registerTable = { density: 'spacious', hasHover: true } as const;

/** A person's initials at the start of a register's row: 40 px, on the identity colour (`theme.ts`). */
export function PersonAvatar({ name }: { name: string }) {
  return <Avatar name={name} size={40} tooltip={false} aria-hidden />;
}
