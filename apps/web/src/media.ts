/**
 * The window sizes every surface decides by. Here rather than in the shell, so the page frame and the parts the shell
 * draws can ask them without importing the shell back; the shell re-exports them.
 */
/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
/**
 * From this window width a pane stands beside the page (D130 rule 11): the rail, the least column a page still reads in
 * and a pane, 260 + 640 + 440 px, the line Kalender's own pane has used since D129. Narrower, or on a short screen
 * (1.4.10), the same pane is a drawer over the page.
 */
export const besideQuery = '(min-width: 1340px)';
