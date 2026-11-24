import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

/**
 * A connector that is configured wrong does not start (CS-L7, CS-L4): each case runs the folder's `server.mjs` under
 * Node, as its image does, with nothing in the environment but what the case gives, and expects it to stop at once,
 * with an error that names the variable. A real-system connector never serves made-up data unless told to: without its
 * adapter variable it does not start, and `fixture` beside the real system's address is refused. Every connector run
 * outside the development stack needs a `CLEW_URL` its keys can be fetched from. Nothing is imported from a connector.
 */
const root = fileURLToPath(new URL('../../connectors/', import.meta.url));
const CLEW_URL = 'https://clew.example';
const CLEW_CONNECTOR_SECRET = 'start-test-transport-key';

/** Runs `node server.mjs` in the folder; the exit code and what it wrote to stderr. Killed if it starts listening. */
async function start(folder: string, env: Record<string, string>) {
  const child = Bun.spawn(['node', 'server.mjs'], {
    cwd: root + folder,
    // PORT 0: a server that starts by mistake takes a free port, and is then stopped below.
    env: { PATH: process.env.PATH ?? '', PORT: '0', ...env },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill(), 5000);
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  clearTimeout(timer);
  return { code, signal: child.signalCode, stderr };
}
/** The process stopped by itself with a failure, and its error names every one of `names`. */
async function refuses(folder: string, env: Record<string, string>, names: string[]) {
  const { code, signal, stderr } = await start(folder, env);
  expect({ folder, env, signal, failed: code !== 0 }).toEqual({ folder, env, signal: null, failed: true });
  const error = stderr.split('\n').find(line => /^\w*Error: /.test(line)) ?? stderr;
  for (const name of names) expect([folder, error]).toEqual([folder, expect.stringContaining(name)]);
}

const base = { CLEW_URL, CLEW_CONNECTOR_SECRET };
describe('a real-system connector does not start without its adapter, or with fixture beside the real system', () => {
  test('supportmanagement: SM_ADAPTER', async () => {
    await Promise.all([
      refuses('supportmanagement', base, ['SM_ADAPTER']),
      refuses('supportmanagement', { ...base, SM_ADAPTER: 'fixture', SM_URL: 'https://sm.example' }, [
        'SM_ADAPTER',
        'SM_URL',
      ]),
    ]);
  });
  test('qlik: QLIK_ADAPTER', async () => {
    await Promise.all([
      refuses('qlik', base, ['QLIK_ADAPTER']),
      refuses('qlik', { ...base, QLIK_ADAPTER: 'fixture', QLIK_URL: 'wss://qlik.example' }, [
        'QLIK_ADAPTER',
        'QLIK_URL',
      ]),
    ]);
  });
  test('phonebook: PHONEBOOK_ADAPTER', async () => {
    await Promise.all([
      refuses('phonebook', base, ['PHONEBOOK_ADAPTER']),
      refuses('phonebook', { ...base, PHONEBOOK_ADAPTER: 'fixture', PHONEBOOK_URL: 'https://phonebook.example' }, [
        'PHONEBOOK_ADAPTER',
        'PHONEBOOK_URL',
      ]),
    ]);
  });
  test('nextcloud-approval: NEXTCLOUD_ADAPTER', async () => {
    await Promise.all([
      refuses('nextcloud-approval', base, ['NEXTCLOUD_ADAPTER']),
      refuses('nextcloud-approval', { ...base, NEXTCLOUD_ADAPTER: 'fixture', NEXTCLOUD_URL: 'https://moln.example' }, [
        'NEXTCLOUD_ADAPTER',
        'NEXTCLOUD_URL',
      ]),
    ]);
  });
  test('pob: POB_ADAPTER', async () => {
    await Promise.all([
      refuses('pob', base, ['POB_ADAPTER']),
      refuses('pob', { ...base, POB_ADAPTER: 'fixture', POB_URL: 'https://pob.example' }, ['POB_ADAPTER', 'POB_URL']),
    ]);
  });
});

test('a connector run outside the development stack does not start without a CLEW_URL its keys can be fetched from', async () => {
  const ready: Record<string, Record<string, string>> = {
    eneo: { ENEO_URL: 'https://eneo.example' },
    hello: {},
    moodle: { MOODLE_ADAPTER: 'fixture' },
    'nextcloud-approval': { NEXTCLOUD_ADAPTER: 'fixture' },
    phonebook: { PHONEBOOK_ADAPTER: 'fixture' },
    pob: { POB_ADAPTER: 'fixture' },
    qlik: { QLIK_ADAPTER: 'fixture' },
    supportmanagement: { SM_ADAPTER: 'fixture' },
  };
  await Promise.all(
    Object.entries(ready).flatMap(([folder, env]) => [
      refuses(folder, { CLEW_CONNECTOR_SECRET, ...env }, ['CLEW_URL']),
      // Plain http from a host outside the development stack: no key would ever be fetched from it.
      refuses(folder, { CLEW_CONNECTOR_SECRET, CLEW_URL: 'http://host.docker.internal:3000', ...env }, ['CLEW_URL']),
    ]),
  );
});
