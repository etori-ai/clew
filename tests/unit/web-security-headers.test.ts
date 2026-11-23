import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { securityHeaders } from '../a11y/security-headers';

/**
 * The web image's security headers (D145): what the policy must keep, and that every location of the image's nginx
 * that serves the built files sends them. The accessibility suite draws every page under the same file.
 */
const root = resolve(import.meta.dir, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
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
  test('the image copies the file in, and every location that serves the built files includes it', () => {
    const at = '/etc/nginx/clew/security-headers.conf';
    expect(read('apps/web/Dockerfile')).toContain(`COPY apps/web/security-headers.conf ${at}`);
    const template = read('apps/web/nginx.conf.template');
    const locations = [...template.matchAll(/location (\S+) \{([^}]*)\}/g)];
    const files = locations.filter(([, , body]) => /try_files/.test(body!));
    expect(files.map(([, path]) => path)).toEqual(['/assets/', '/']);
    for (const [, , body] of files) expect(body).toContain(`include ${at};`);
    // Clew's server answers its own addresses: the front-channel logout must stay loadable in the provider's frame (D121).
    for (const [, path, body] of locations.filter(([, , b]) => /proxy_pass/.test(b!)))
      expect([path, body!.includes('security-headers')]).toEqual([path, false]);
  });
});
