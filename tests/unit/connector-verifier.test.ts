import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { decodeJwt } from 'jose';
import type { Actor } from '../../packages/connectors/src/index';
import type { AssertionBinding } from '../../packages/connectors/src/remote';
import {
  bindingOf,
  createVerifier,
  keysAddress,
  verifyAssertion,
  verifyInstallationAssertion,
} from '../../connectors/hello/verification.mjs';
import { testAuthority, testJwks } from '../connector-authority';

/**
 * The verifier every connector in the repository carries (`connectors/<id>/verification.mjs`, D117): one file, copied
 * into each folder so that a connector depends on nothing else, and held to the same text here. An assertion is good for
 * the one request Clew signed it for and for that request once: its route, its body, the capability of its route, the
 * operation id of an approved write, and its `jti` (CS-L1, CS-L2).
 */
const root = new URL('../../connectors/', import.meta.url);
const folders = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const secret = 'verifier-transport-key';
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const sign = async (binding: AssertionBinding) => (await testAuthority()).assert('src', hillevi, [], [], binding);
const request = (token: string, path: string, body: string, headers: Record<string, string> = {}) =>
  new Request('http://src' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'x-clew-connector-key': secret, ...headers },
    body,
  });
/** A verifier that has seen nothing yet, as a connector's process has when it starts. */
const fresh = () => createVerifier({ secret, jwks: testJwks }, 'src');
const body = JSON.stringify({ actor: hillevi, input: {} });
const route = '/clew/capabilities/src.read';

describe('the verifier every connector carries', () => {
  test('is one file: every connector folder has the same copy, and every copy of its types is the same', () => {
    const text = (path: string) => readFileSync(new URL(path, root), 'utf8');
    const verifier = text('hello/verification.mjs');
    expect(folders.filter(f => !existsSync(new URL(`${f}/verification.mjs`, root)))).toEqual([]);
    expect(folders.filter(f => text(`${f}/verification.mjs`) !== verifier)).toEqual([]);
    const types = text('hello/verification.d.mts');
    const typed = folders.filter(f => existsSync(new URL(`${f}/verification.d.mts`, root)));
    expect(typed.filter(f => text(`${f}/verification.d.mts`) !== types)).toEqual([]);
  });

  test('takes an assertion once: the same request again is a copy, refused, and a refused copy uses nothing up', async () => {
    const verify = fresh();
    const token = await sign({ path: route, body });
    // Presented with another body first: refused, and not recorded.
    expect(
      await verify(token, secret, request(token, route, JSON.stringify({ actor: hillevi, input: { x: 1 } }))),
    ).toBe(null);
    expect(await verify(token, secret, request(token, route, body))).toMatchObject({ id: 'hillevi' });
    expect(await verify(token, secret, request(token, route, body))).toBeNull();
    // Clew signs a new assertion for the same call sent again, which is taken.
    const again = await sign({ path: route, body });
    expect(await verify(again, secret, request(again, route, body))).toMatchObject({ id: 'hillevi' });
    // The installation's own assertion likewise (D119).
    const read = JSON.stringify({ input: {} });
    const at = '/clew/installation/src.holdings';
    const installation = await (await testAuthority()).installation('src', { path: at, body: read });
    expect(await verify.installation(installation, secret, request(installation, at, read))).toBe(true);
    expect(await verify.installation(installation, secret, request(installation, at, read))).toBe(false);
  });

  test("binds an approved write's operation id: another, none, or one the assertion does not carry is refused", async () => {
    const at = '/clew/capabilities/src.write';
    const write = await sign({ path: at, body, operationId: 'op-1' });
    expect(decodeJwt(write).operationId).toBe('op-1');
    expect(await fresh()(write, secret, request(write, at, body, { 'x-clew-operation-id': 'op-2' }))).toBeNull();
    expect(await fresh()(write, secret, request(write, at, body))).toBeNull();
    expect(await fresh()(write, secret, request(write, at, body, { 'x-clew-operation-id': 'op-1' }))).toMatchObject({
      id: 'hillevi',
    });
    const plain = await sign({ path: at, body });
    expect(decodeJwt(plain).operationId).toBeUndefined();
    expect(await fresh()(plain, secret, request(plain, at, body, { 'x-clew-operation-id': 'op-1' }))).toBeNull();
    expect(await fresh()(plain, secret, request(plain, at, body))).toMatchObject({ id: 'hillevi' });
  });

  test("takes an assertion on the route it was signed for and no other: a scan's is refused on /clew/figure", async () => {
    const scanBody = JSON.stringify({ actor: hillevi });
    const scan = await sign({ path: '/clew/scan', body: scanBody });
    expect(decodeJwt(scan)).toMatchObject({ path: '/clew/scan' });
    expect(decodeJwt(scan).capability).toBeUndefined();
    const verify = fresh();
    for (const path of [
      '/clew/figure',
      '/clew/documents',
      '/clew/ask',
      '/clew/XXXXXXXXXXXXXsrc.read',
      '/clew/capabilitiesXsrc.read',
      '/aaaaaaaaaaaaaaaaaasrc.read',
      '/clew/capabilities/src.read',
      '/clew/scan/src.read',
      '/clew/scan/',
      '/prefix/clew/scan',
      '/clew/manifest',
      '/clew/',
      '/',
    ])
      expect([path, await verify(scan, secret, request(scan, path, scanBody))]).toEqual([path, null]);
    // Nothing was used up by the refusals: on its own route it is still taken.
    expect(await verify(scan, secret, request(scan, '/clew/scan', scanBody))).toMatchObject({ id: 'hillevi' });
    // A capability's assertion likewise: on its own route exactly, not under a prefix or with more after the name.
    const read = await sign({ path: route, body });
    expect(decodeJwt(read)).toMatchObject({ path: route, capability: 'src.read' });
    for (const path of [
      '/prefix' + route,
      route + '/more',
      '/clew/capabilities/src.other',
      '/clew/installation/src.read',
    ])
      expect([path, await verify(read, secret, request(read, path, body))]).toEqual([path, null]);
    expect(await verify(read, secret, request(read, route, body))).toMatchObject({ id: 'hillevi' });
    // The signer signs only a route of the protocol, and reads the capability from it, so the two never disagree.
    await expect(sign({ path: 'src.read', body })).rejects.toThrow('bound');
    await expect(sign({ path: '/clew/capabilities/%E0', body })).rejects.toThrow('bound');
  });

  test('refuses a call without the request: nothing is verified unbound', async () => {
    const token = await sign({ path: route, body });
    const installation = await (
      await testAuthority()
    ).installation('src', { path: '/clew/installation/src.holdings', body });
    const verify = fresh();
    expect(await verify(token, secret, undefined as never)).toBeNull();
    expect(await verify.installation(installation, secret, undefined as never)).toBe(false);
    const jwks = await testJwks();
    expect(verifyAssertion(token, jwks, 'src', Date.now(), undefined as never)).toBeNull();
    expect(verifyInstallationAssertion(installation, jwks, 'src', Date.now(), undefined as never)).toBe(false);
    // A binding without its path binds nothing either.
    const { path: _path, ...withoutPath } = await bindingOf(request(token, route, body));
    expect(verifyAssertion(token, jwks, 'src', Date.now(), withoutPath as never)).toBeNull();
    expect(verifyAssertion(token, jwks, 'src', Date.now(), await bindingOf(request(token, route, body)))).toMatchObject(
      {
        id: 'hillevi',
      },
    );
    // Refused without the request, the assertion was not used up: with it, it is taken.
    expect(await verify(token, secret, request(token, route, body))).toMatchObject({ id: 'hillevi' });
  });

  test('judges an assertion and its jti at one instant: a copy at the tick it expires on is refused', async () => {
    const token = await sign({ path: route, body });
    const installation = await (
      await testAuthority()
    ).installation('src', { path: '/clew/installation/src.holdings', body });
    const verify = fresh();
    expect(await verify(token, secret, request(token, route, body))).toMatchObject({ id: 'hillevi' });
    expect(
      await verify.installation(installation, secret, request(installation, '/clew/installation/src.holdings', body)),
    ).toBe(true);
    // The clock straddles the tick: the millisecond before `exp` when it is first read, `exp` itself after that. Read
    // twice, the copy was still valid at the first read and its own record gone at the second, so it was taken again.
    for (const [token_, path, take] of [
      [token, route, () => verify(token, secret, request(token, route, body))],
      [
        installation,
        '/clew/installation/src.holdings',
        () => verify.installation(installation, secret, request(installation, '/clew/installation/src.holdings', body)),
      ],
    ] as const) {
      const exp = (decodeJwt(token_).exp as number) * 1000;
      expect(path).toStartWith('/clew/');
      let reads = 0;
      const clock = spyOn(Date, 'now').mockImplementation(() => (reads++ === 0 ? exp - 1 : exp));
      try {
        expect(await take()).toBeFalsy();
      } finally {
        clock.mockRestore();
      }
      expect(reads).toBeGreaterThan(0);
    }
  });

  test('fetches keys only from https or a host of the development stack, which a connector checks at start', () => {
    expect(keysAddress('https://clew.example')).toBe('https://clew.example/api/connectors/jwks');
    expect(keysAddress('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/api/connectors/jwks');
    expect(keysAddress('http://app:3000')).toBe('http://app:3000/api/connectors/jwks');
    for (const wrong of ['', undefined, 'clew.example', 'http://host.docker.internal:3000', 'ftp://localhost/'])
      expect([wrong, keysAddress(wrong)]).toEqual([wrong, null]);
  });
});
