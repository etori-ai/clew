/** The base an address is read against: no real host, so anything that leaves it names another site. */
const HERE = 'https://clew.invalid';
/**
 * The address inside Clew that sign-in returns to, its query kept so a step or an item open stays (D116; WD-M3 of the
 * web review of 2026-11-23), or `/`. The browser refuses what the server's `localReturnTo` refuses, so a link never
 * leads out of Clew from here either: an address that does not start with one `/`, one that starts `//` or `/\` (which
 * a browser reads as `//`, another site), a backslash, a tab or a line break anywhere, an API address and the sign-in
 * page itself.
 */
export function signInTarget(address: string): string {
  if (!address.startsWith('/') || address.startsWith('//') || /[\\\t\r\n]/.test(address)) return '/';
  let url: URL;
  try {
    url = new URL(address, HERE);
  } catch {
    return '/';
  }
  if (
    url.origin !== HERE ||
    url.pathname.startsWith('//') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/login'
  )
    return '/';
  return url.pathname + url.search;
}
/** "Logga in" (and "Logga in igen"): the sign-in, back to `address` afterwards (`signInTarget`). */
export const signInHref = (address: string) => '/api/auth/login?returnTo=' + encodeURIComponent(signInTarget(address));
