import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import {
  ProvisionerIssueInput,
  type ProvisionerIssueInputType,
  type ProvisionerKeyIssued,
  ProvisionerRotateInput,
  type ProvisionerRotateInputType,
} from '@clew/contracts';
import { InputError, failure, privateHeaders, type Env } from '../context';
import type { UsersAdminUsecases } from '../modules/people/usecases';
import { scimAddress } from './scim';

/**
 * The provisioners' keys (D107), mounted under `/api/admin/users/provisioners` behind the administration's session
 * guard: issue, replace, take back. Thin: parse, validate, call one use case. The two answers that carry a key say
 * where the provisioner sends it, which is the server's to know, and are marked never to be stored by anything
 * between the server and the page. A factory over the use cases, so the routes are tested without the composition
 * (`tests/unit/provisioner-key-routes.test.ts`).
 */
const ajv = new Ajv({ allErrors: false });
const validIssue = ajv.compile(ProvisionerIssueInput),
  validRotate = ajv.compile(ProvisionerRotateInput);
async function body<T>(request: Request, validate: (value: unknown) => boolean): Promise<T> {
  const text = await request.text();
  if (text.length > 2000) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value as T;
}
export function provisionerKeyRoutes(
  keys: Pick<UsersAdminUsecases, 'issueProvisioner' | 'rotateProvisioner' | 'revokeProvisioner'>,
  /** Who is signed in, for a test: the administration mounts these routes behind its own session guard. */
  guard?: MiddlewareHandler<Env>,
) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  // The same mapping the server gives every route, so a refusal reads the same wherever these are mounted.
  routes.onError((error, c) => failure(c, error));
  const answered = (requestUrl: string, issued: Omit<ProvisionerKeyIssued, 'address'>): ProvisionerKeyIssued => ({
    ...issued,
    address: scimAddress(requestUrl),
  });
  routes.post('/', async c =>
    c.json(
      answered(
        c.req.url,
        await keys.issueProvisioner(
          c.get('session').context,
          await body<ProvisionerIssueInputType>(c.req.raw, validIssue),
        ),
      ),
      200,
      privateHeaders,
    ),
  );
  routes.post('/:id/rotate', async c =>
    c.json(
      answered(
        c.req.url,
        await keys.rotateProvisioner(
          c.get('session').context,
          c.req.param('id'),
          await body<ProvisionerRotateInputType>(c.req.raw, validRotate),
        ),
      ),
      200,
      privateHeaders,
    ),
  );
  routes.post('/:id/revoke', async c =>
    c.json(await keys.revokeProvisioner(c.get('session').context, c.req.param('id'))),
  );
  return routes;
}
