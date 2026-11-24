import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { decodeJwt } from 'jose';
import type { Actor } from '../../packages/connectors/src/index';
import type { AssertionBinding } from '../../packages/connectors/src/remote';
import { createVerifier } from '../../connectors/hello/verification.mjs';
import { testAuthority, testJwks } from '../connector-authority';

/**
 * The verifier every connector in the repository carries (`connectors/<id>/verification.mjs`, D117): one file, copied
 * into each folder so that a connector depends on nothing else, and held to the same text here. An assertion is good for
 * the one request Clew signed it for and for that request once: its body, the capability of its route, the operation id
 * of an approved write, and its `jti` (CS-L1, CS-L2).
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
    const token = await sign({ body, capability: 'src.read' });
    // Presented with another body first: refused, and not recorded.
    expect(
      await verify(token, secret, request(token, route, JSON.stringify({ actor: hillevi, input: { x: 1 } }))),
    ).toBe(null);
    expect(await verify(token, secret, request(token, route, body))).toMatchObject({ id: 'hillevi' });
    expect(await verify(token, secret, request(token, route, body))).toBeNull();
    // Clew signs a new assertion for the same call sent again, which is taken.
    const again = await sign({ body, capability: 'src.read' });
    expect(await verify(again, secret, request(again, route, body))).toMatchObject({ id: 'hillevi' });
    // The installation's own assertion likewise (D119).
    const read = JSON.stringify({ input: {} });
    const installation = await (await testAuthority()).installation('src', { body: read, capability: 'src.holdings' });
    const at = '/clew/installation/src.holdings';
    expect(await verify.installation(installation, secret, request(installation, at, read))).toBe(true);
    expect(await verify.installation(installation, secret, request(installation, at, read))).toBe(false);
  });

  test("binds an approved write's operation id: another, none, or one the assertion does not carry is refused", async () => {
    const write = await sign({ body, capability: 'src.write', operationId: 'op-1' });
    expect(decodeJwt(write).operationId).toBe('op-1');
    const at = '/clew/capabilities/src.write';
    expect(await fresh()(write, secret, request(write, at, body, { 'x-clew-operation-id': 'op-2' }))).toBeNull();
    expect(await fresh()(write, secret, request(write, at, body))).toBeNull();
    expect(await fresh()(write, secret, request(write, at, body, { 'x-clew-operation-id': 'op-1' }))).toMatchObject({
      id: 'hillevi',
    });
    const plain = await sign({ body, capability: 'src.write' });
    expect(decodeJwt(plain).operationId).toBeUndefined();
    expect(await fresh()(plain, secret, request(plain, at, body, { 'x-clew-operation-id': 'op-1' }))).toBeNull();
    expect(await fresh()(plain, secret, request(plain, at, body))).toMatchObject({ id: 'hillevi' });
  });

  test('takes an assertion that names no capability only on the four routes that name none, exactly', async () => {
    const scanBody = JSON.stringify({ actor: hillevi });
    const scan = await sign({ body: scanBody });
    const verify = fresh();
    for (const path of [
      '/clew/XXXXXXXXXXXXXsrc.read',
      '/clew/capabilitiesXsrc.read',
      '/aaaaaaaaaaaaaaaaaasrc.read',
      '/clew/capabilities/src.read',
      '/clew/scan/src.read',
      '/prefix/clew/scan',
      '/clew/manifest',
      '/clew/',
      '/',
    ])
      expect([path, await verify(scan, secret, request(scan, path, scanBody))]).toEqual([path, null]);
    // Nothing was used up by the refusals: on its own route it is still taken.
    expect(await verify(scan, secret, request(scan, '/clew/scan', scanBody))).toMatchObject({ id: 'hillevi' });
    for (const path of ['/clew/figure', '/clew/documents', '/clew/ask'])
      expect([path, await fresh()(scan, secret, request(scan, path, scanBody))]).toEqual([
        path,
        expect.objectContaining({ id: 'hillevi' }),
      ]);
  });
});
