/**
 * The window sizes every surface decides by. Here rather than in the shell, which draws the panel a page leaves to it
 * (`components/page-panel.tsx`), so the panel can ask them without importing the shell back; the shell re-exports them.
 */
/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
