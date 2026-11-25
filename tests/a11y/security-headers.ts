import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The headers the web image serves every page and file with (D145), read from the file its nginx includes, so the suite
 * draws every page under the policy an installation sends. Each line is `add_header <Name> "<value>" always;`, a
 * comment or blank; any other line is an error, so a header written another way is never silently left out of the suite.
 */
export function securityHeaders(): Record<string, string> {
  return parseSecurityHeaders(
    readFileSync(resolve(import.meta.dirname, '../../apps/web/security-headers.conf'), 'utf8'),
  );
}

export function parseSecurityHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const header = /^add_header ([A-Za-z-]+) "([^"]+)" always;$/.exec(line);
    if (!header)
      throw new Error(`apps/web/security-headers.conf line ${i + 1} is no add_header the suite reads: ${line}`);
    if (headers[header[1]!] !== undefined) throw new Error(`apps/web/security-headers.conf sets ${header[1]} twice`);
    headers[header[1]!] = header[2]!;
  }
  if (!headers['Content-Security-Policy']) throw new Error('apps/web/security-headers.conf sets no policy');
  return headers;
}
