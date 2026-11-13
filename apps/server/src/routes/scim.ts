import { Hono, type Context } from 'hono';
import { privateHeaders } from '../context';
import { SCIM_CONTENT_TYPE, ScimError } from '../modules/people/contracts';
import { project, resourceTypes, schemaDocuments, serviceProviderConfig } from '../modules/people/domain';
import type { Provisioner } from '../modules/people/ports';
import type { ScimQuery, ScimUsecases } from '../modules/people/usecases';

/**
 * SCIM 2.0 under `/scim/v2` (RFC 7644; D68): the one way people and groups enter an installation. A bearer token issued to
 * a provisioner authenticates every request, discovery included. Routes parse, validate the shape of the address and
 * call one use case; the body is validated in the use case, which also owns the transaction, the audit row and the
 * derivation. Errors are the standard's error resource, in English: a machine reads them.
 */
type Env = { Variables: { provisioner: Provisioner } };
/**
 * Where the SCIM server answers, as a provisioner reaches it: the installation's public address when one is set, else
 * the origin the request came to. The resources' own `meta.location` and the key dialog (D107) both say this.
 */
export const scimAddress = (requestUrl: string) =>
  (process.env.PUBLIC_URL ?? new URL(requestUrl).origin).replace(/\/+$/, '') + '/scim/v2';
/** Four megabytes: a group of ten thousand members, the largest resource a municipal push carries, is well under it. */
const BODY_LIMIT = 4 * 1024 * 1024;
/**
 * Where an unexpected failure is said (D91). Required, so that no caller swallows one by leaving it out: the server
 * binds its log port, a script prints, and a test that expects a failure says so by handing in its own.
 */
export type ScimLog = (message: string, ...details: unknown[]) => void;
export function scimRoutes(scim: ScimUsecases, log: ScimLog) {
  const app = new Hono<Env>();
  const json = (c: Context, body: unknown, status: 200 | 201 = 200, headers: Record<string, string> = {}) =>
    c.body(JSON.stringify(body), status, { 'Content-Type': SCIM_CONTENT_TYPE, ...privateHeaders, ...headers });
  /**
   * The resource a write answers, with the caller's `attributes` and `excludedAttributes` applied (RFC 7644 §3.9: they
   * hold for every operation that returns a resource). A client that changes one member of a large group asks to have
   * the members left out of the answer.
   */
  const written = <T extends { meta: { location: string } }>(c: Context, resource: T, status: 200 | 201 = 200) =>
    json(c, project(resource, projection(c)), status, status === 201 ? { Location: resource.meta.location } : {});
  /**
   * A unique index that fired before the use case's own check saw the other row (two requests at once) is the
   * standard's 409, like the check's. Postgres names the constraint; the driver may wrap the error once.
   */
  const UNIQUE_VIOLATION = '23505',
    constraintAttribute: Record<string, string> = {
      auth_person_user_name: 'userName',
      auth_person_external_id: 'externalId',
      auth_group_external_id: 'externalId',
    };
  const asScimError = (error: unknown): ScimError => {
    if (error instanceof ScimError) return error;
    const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
    const code = e?.code ?? e?.cause?.code,
      constraint = e?.constraint_name ?? e?.cause?.constraint_name ?? '';
    if (code === UNIQUE_VIOLATION)
      return new ScimError(
        409,
        `A resource with this ${constraintAttribute[constraint] ?? 'userName or externalId'} already exists.`,
        'uniqueness',
      );
    log('scim: the request failed unexpectedly', error);
    return new ScimError(500, 'The request could not be completed.');
  };
  const fail = (c: Context, error: unknown, headers: Record<string, string> = {}) => {
    const scim = asScimError(error);
    return c.body(JSON.stringify(scim.body()), scim.status, {
      'Content-Type': SCIM_CONTENT_TYPE,
      ...privateHeaders,
      ...headers,
    });
  };
  const base = (c: Context) => scimAddress(c.req.url);
  const body = async (c: Context): Promise<unknown> => {
    // The declared length first, so an oversized body is refused before it is read; then the measured one, for a
    // chunked body that declares none.
    if (Number(c.req.header('content-length') ?? 0) > BODY_LIMIT)
      throw new ScimError(413, 'The request body is too large.');
    // Read a piece at a time and stopped at the limit, in bytes as the limit is: a body that declares no length is
    // not held in memory whole before it is measured.
    const pieces: Uint8Array[] = [];
    let size = 0;
    const reader = c.req.raw.body?.getReader();
    for (let piece = await reader?.read(); piece && !piece.done; piece = await reader!.read()) {
      size += piece.value.byteLength;
      if (size > BODY_LIMIT) {
        await reader!.cancel();
        throw new ScimError(413, 'The request body is too large.');
      }
      pieces.push(piece.value);
    }
    const text = new TextDecoder().decode(Buffer.concat(pieces));
    try {
      return JSON.parse(text);
    } catch {
      throw new ScimError(400, 'The request body is not JSON.', 'invalidSyntax');
    }
  };
  const route = (fn: (c: Context<Env>) => Promise<Response>) => async (c: Context<Env>) => {
    try {
      return await fn(c);
    } catch (error) {
      return fail(c, error);
    }
  };
  app.use('*', async (c, next) => {
    // The scheme's name is read without regard to case (RFC 9110 §11.1): `bearer` is `Bearer`.
    const token = /^bearer\s+(\S.*)$/i.exec(c.req.header('authorization') ?? '')?.[1]?.trim();
    let provisioner: Provisioner | undefined;
    try {
      provisioner = token ? await scim.authenticate(token) : undefined;
    } catch (error) {
      // The store did not answer. Said as the standard's error, with a time to try again, and not by whatever the
      // application around this one answers a failure with.
      log('scim: a token could not be checked', error);
      return fail(c, new ScimError(503, 'The service cannot check the token now. Retry shortly.'), {
        'Retry-After': '5',
      });
    }
    if (!provisioner)
      return c.body(
        JSON.stringify(new ScimError(401, 'A bearer token issued to a provisioner is required.').body()),
        401,
        { 'Content-Type': SCIM_CONTENT_TYPE, ...privateHeaders, 'WWW-Authenticate': 'Bearer realm="scim"' },
      );
    c.set('provisioner', provisioner);
    await next();
  });
  app.get(
    '/ServiceProviderConfig',
    route(async c => json(c, serviceProviderConfig(base(c)))),
  );
  app.get(
    '/ResourceTypes',
    route(async c => json(c, listOf(resourceTypes(base(c))))),
  );
  app.get(
    '/ResourceTypes/:id',
    route(async c => {
      const found = resourceTypes(base(c)).find(r => r.id === idOf(c));
      if (!found) throw new ScimError(404, `Resource type '${idOf(c)}' not found.`);
      return json(c, found);
    }),
  );
  app.get(
    '/Schemas',
    route(async c => json(c, listOf(schemaDocuments(base(c))))),
  );
  app.get(
    '/Schemas/:id',
    route(async c => {
      const found = schemaDocuments(base(c)).find(s => s.id === idOf(c));
      if (!found) throw new ScimError(404, `Schema '${idOf(c)}' not found.`);
      return json(c, found);
    }),
  );
  const idOf = (c: Context) => c.req.param('id') ?? '';
  const projection = (c: Context) => ({
    attributes: c.req.query('attributes'),
    excludedAttributes: c.req.query('excludedAttributes'),
  });
  const query = (c: Context): ScimQuery => ({
    filter: c.req.query('filter'),
    startIndex: c.req.query('startIndex'),
    count: c.req.query('count'),
    ...projection(c),
  });
  /** RFC 7644 §3.4.3: the query of a list carried in a `SearchRequest` body, for clients that keep filters out of the address. */
  const searchQuery = async (c: Context): Promise<ScimQuery> => {
    const sent = await body(c);
    if (!sent || typeof sent !== 'object' || Array.isArray(sent))
      throw new ScimError(400, 'A SearchRequest body is required.', 'invalidSyntax');
    // Names without regard to case, as every attribute name is (RFC 7643 §2.1): `Filter` read as no filter answered
    // every row to a client that asked whether one existed.
    const s = Object.fromEntries(Object.entries(sent).map(([name, value]) => [name.toLowerCase(), value])),
      // A SearchRequest carries the two attribute lists as arrays; `String` joins them with the comma the address uses.
      text = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
    return {
      filter: text(s.filter),
      startIndex: text(s.startindex),
      count: text(s.count),
      attributes: text(s.attributes),
      excludedAttributes: text(s.excludedattributes),
    };
  };
  /** RFC 7644 §3.7 and §3.11: what this server does not offer answers 501, not 404, so a client can tell the two apart. */
  const notImplemented = (what: string) =>
    route(async () => {
      throw new ScimError(501, `${what} is not supported by this server.`);
    });
  // An address that exists, asked with a method it does not take (RFC 9110 §15.5.6): 405 and what it does take.
  const notAllowed = (allow: string) => (c: Context) =>
    fail(c, new ScimError(405, `This address takes ${allow}.`), { Allow: allow });
  app.all('/Bulk', notImplemented('Bulk'));
  app.all('/Me', notImplemented('/Me'));
  app.all('/.search', notImplemented('A search across resource types'));
  app.post(
    '/Users',
    route(async c => {
      return written(c, await scim.createUser(c.get('provisioner'), await body(c), base(c)), 201);
    }),
  );
  app.get(
    '/Users',
    route(async c => json(c, await scim.listUsers(c.get('provisioner'), query(c), base(c)))),
  );
  app.post(
    '/Users/.search',
    route(async c => json(c, await scim.listUsers(c.get('provisioner'), await searchQuery(c), base(c)))),
  );
  // Before `/:id`, which would read `.search` as the id of a resource.
  app.all('/Users/.search', notAllowed('POST'));
  app.get(
    '/Users/:id',
    route(async c => json(c, await scim.getUser(c.get('provisioner'), idOf(c), base(c), projection(c)))),
  );
  app.put(
    '/Users/:id',
    route(async c => written(c, await scim.replaceUser(c.get('provisioner'), idOf(c), await body(c), base(c)))),
  );
  app.patch(
    '/Users/:id',
    route(async c => written(c, await scim.patchUser(c.get('provisioner'), idOf(c), await body(c), base(c)))),
  );
  app.delete(
    '/Users/:id',
    route(async c => {
      await scim.deleteUser(c.get('provisioner'), idOf(c));
      return c.body(null, 204, privateHeaders);
    }),
  );
  app.post(
    '/Groups',
    route(async c => {
      return written(c, await scim.createGroup(c.get('provisioner'), await body(c), base(c)), 201);
    }),
  );
  app.get(
    '/Groups',
    route(async c => json(c, await scim.listGroups(c.get('provisioner'), query(c), base(c)))),
  );
  app.post(
    '/Groups/.search',
    route(async c => json(c, await scim.listGroups(c.get('provisioner'), await searchQuery(c), base(c)))),
  );
  // Before `/:id`, which would read `.search` as the id of a resource.
  app.all('/Groups/.search', notAllowed('POST'));
  app.get(
    '/Groups/:id',
    route(async c => json(c, await scim.getGroup(c.get('provisioner'), idOf(c), base(c), projection(c)))),
  );
  app.put(
    '/Groups/:id',
    route(async c => written(c, await scim.replaceGroup(c.get('provisioner'), idOf(c), await body(c), base(c)))),
  );
  app.patch(
    '/Groups/:id',
    route(async c => written(c, await scim.patchGroup(c.get('provisioner'), idOf(c), await body(c), base(c)))),
  );
  app.delete(
    '/Groups/:id',
    route(async c => {
      await scim.deleteGroup(c.get('provisioner'), idOf(c));
      return c.body(null, 204, privateHeaders);
    }),
  );
  // A handler, not `notFound`: Hono does not carry a sub-app's not-found handler through `app.route()`, so the parent's
  // Swedish JSON 404 answered here before. The token middleware above runs first, so an unknown address still needs one.
  // What is left of an address that exists is a method it does not take.
  for (const collection of ['/Users', '/Groups']) {
    app.all(collection, notAllowed('GET, POST'));
    app.all(collection + '/:id', notAllowed('GET, PUT, PATCH, DELETE'));
  }
  // Discovery is read only: another method there once fell through to the 404 below.
  for (const discovery of [
    '/ServiceProviderConfig',
    '/ResourceTypes',
    '/ResourceTypes/:id',
    '/Schemas',
    '/Schemas/:id',
  ])
    app.all(discovery, notAllowed('GET'));
  app.all('*', c => fail(c, new ScimError(404, 'No such SCIM resource.')));
  return app;
}
const listOf = <T>(Resources: T[]) => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: Resources.length,
  startIndex: 1,
  itemsPerPage: Resources.length,
  Resources,
});
