import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The headers the web image serves every page and file with (D145), read from the file its nginx includes, so the suite
 * draws every page under the policy an installation sends. Each line is `add_header <Name> "<value>" always;`.
 */
export function securityHeaders(): Record<string, string> {
  const text = readFileSync(resolve(import.meta.dirname, '../../apps/web/security-headers.conf'), 'utf8');
  const headers = Object.fromEntries(
    [...text.matchAll(/^add_header ([A-Za-z-]+) "([^"]+)" always;$/gm)].map(([, name, value]) => [name!, value!]),
  );
  if (!headers['Content-Security-Policy']) throw new Error('apps/web/security-headers.conf sets no policy');
  return headers;
}
