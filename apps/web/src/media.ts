/**
 * The window sizes every surface decides by. Here rather than in the shell, so the page frame and the parts the shell
 * draws can ask them without importing the shell back; the shell re-exports them.
 */
/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/**
 * The narrowest screens, down to the 320 px that 1.4.10 asks for: the page frame takes its tighter 16 px inset there
 * (the boards keep 24 px on a phone: Hem, Att göra and Ärende at 390 px), and two controls that share a row on a phone
 * stand one under the other.
 */
export const tightQuery = '(max-width: 359px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';
