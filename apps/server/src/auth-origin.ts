/**
 * The origins a mutation may come from (D67 item 6): the installation's public origin, and the front-end origins an
 * operator lists in `FRONTEND_ORIGINS` (comma-separated), for a second front end on another port or host of the same
 * installation. Each entry must be a bare origin under the public origin's scheme; anything else is refused at start,
 * never silently dropped. The CSRF token is checked besides, never instead.
 */
export function frontendOrigins(publicOrigin: string, listed: string | undefined): string[] {
  const scheme = new URL(publicOrigin).protocol;
  const origins = [publicOrigin];
  for (const entry of (listed ?? '').split(',')) {
    const value = entry.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`FRONTEND_ORIGINS entry is not an origin: ${value}`);
    }
    if (url.origin !== value || url.protocol !== scheme)
      throw new Error(`FRONTEND_ORIGINS entry must be a bare ${scheme.slice(0, -1)} origin: ${value}`);
    if (!origins.includes(value)) origins.push(value);
  }
  return origins;
}
