import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSecurityHeaders, securityHeaders } from '../a11y/security-headers';

/**
 * The web image's security headers (D145): what the policy must keep, and that every location of the image's nginx
 * that serves the built files sends them. The accessibility suite draws every page under the same file.
 */
const root = resolve(import.meta.dir, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
/**
 * Every `location` block of an nginx configuration with its whole body, nested blocks included: the braces are counted,
 * so an `if` or a nested location inside one does not end it early. Comments are dropped first; the template quotes no
 * brace.
 */
function locations(config: string): Array<{ path: string; body: string }> {
  const text = config.replace(/#[^\n]*/g, '');
  const found: Array<{ path: string; body: string }> = [];
  for (const start of text.matchAll(/\blocation\s+([^{;]+?)\s*\{/g)) {
    let depth = 1;
    let at = start.index + start[0].length;
    const open = at;
    for (; at < text.length && depth > 0; at++) {
      if (text[at] === '{') depth++;
      else if (text[at] === '}') depth--;
    }
    if (depth !== 0) throw new Error(`location ${start[1]} is never closed`);
    found.push({ path: start[1]!, body: text.slice(open, at - 1) });
  }
  return found;
}
const headers = securityHeaders();
const policy = new Map(
  headers['Content-Security-Policy']!.split(';').map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name!, sources] as const;
  }),
);

describe('the web app’s security headers', () => {
  test('scripts, connections and workers come from Clew’s own origin only, and nothing runs inline or from a string', () => {
    for (const directive of ['default-src', 'script-src', 'connect-src', 'worker-src'])
      expect(policy.get(directive)).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    for (const [directive, sources] of policy)
      if (directive !== 'style-src') expect(sources).not.toContain("'unsafe-inline'");
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
    expect(headers['Content-Security-Policy']).not.toMatch(/\*|http:/);
  });
  test('no page may frame Clew, and the other headers are sent', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(headers).toMatchObject({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000',
    });
  });
  test('the image copies the file in, and every location that is not Clew’s server includes it', () => {
    const at = '/etc/nginx/clew/security-headers.conf';
    expect(read('apps/web/Dockerfile')).toContain(`COPY apps/web/security-headers.conf ${at}`);
    const all = locations(read('apps/web/nginx.conf.template'));
    expect(all.map(l => l.path)).toEqual(['/api/', '/scim/', '/assets/', '/']);
    // Whatever nginx answers itself (a file, index.html, a redirect, an error) carries the headers; a location added
    // later is held to it without being named here.
    for (const { path, body } of all.filter(l => !/\bproxy_pass\b/.test(l.body)))
      expect([path, body.includes(`include ${at};`)]).toEqual([path, true]);
    // Clew's server answers its own addresses: the front-channel logout must stay loadable in the provider's frame (D121).
    for (const { path, body } of all.filter(l => /\bproxy_pass\b/.test(l.body)))
      expect([path, body.includes('security-headers')]).toEqual([path, false]);
  });
  test('the suite’s reader of the file refuses a line it does not read, so no header is silently left out', () => {
    const policy = 'add_header Content-Security-Policy "default-src \'self\'" always;';
    expect(parseSecurityHeaders(`# a comment\n\n${policy}\n`)).toEqual({
      'Content-Security-Policy': "default-src 'self'",
    });
    expect(() => parseSecurityHeaders(`${policy}\nadd_header X-Frame-Options DENY always;\n`)).toThrow('line 2');
    expect(() => parseSecurityHeaders(`${policy}\nadd_header  Referrer-Policy "same-origin";\n`)).toThrow('line 2');
    expect(() => parseSecurityHeaders(`${policy}\n${policy}\n`)).toThrow('twice');
    expect(() => parseSecurityHeaders('add_header X-Frame-Options "DENY" always;\n')).toThrow('no policy');
  });
  test('the location reader counts braces, so a nested block does not end a location early', () => {
    const nested = locations(`server {
      location / { if ($x) { return 404; } include /etc/nginx/clew/security-headers.conf; }
      # location /commented/ { }
      location = /exact { return 204; }
    }`);
    expect(nested.map(l => l.path)).toEqual(['/', '= /exact']);
    expect(nested[0]!.body).toContain('security-headers');
    expect(() => locations('location / { if ($x) { return 404; }')).toThrow('never closed');
  });
});
