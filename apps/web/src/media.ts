/**
 * The window sizes every surface decides by. Here rather than in the shell, so the page frame and the parts the shell
 * draws can ask them without importing the shell back; the shell re-exports them.
 */
/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
/**
 * From this window width Kalender's own pane stands beside its grid (D129): the rail, the week's least column and the
 * pane, 260 + 640 + 440 px, measured before the rail was taken away (D130). Narrower, or on a short screen (1.4.10), it is
 * a drawer over the page.
 */
export const besideQuery = '(min-width: 1340px)';
/**
 * From this window width the assistant's pane stands as a card in the shell's column beside the page (D138 item 4); below
 * it, or on a short screen (1.4.10), it is a drawer over the page. Not drawn on the canvas: the line where Hem's two
 * columns already stand one under the other (D130 item 7), where the page keeps 696 px beside the 400 px card and the
 * 20 px between them (1180 less the column's 64 px of gutter).
 */
export const paneBesideQuery = '(min-width: 1180px)';
