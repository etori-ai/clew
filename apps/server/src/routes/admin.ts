import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AddConnectorInput, ConnectorPatchInput, PreviewQuery, RefreshManifestInput, RotateSecretInput } from '@clew/contracts';
import type { AddConnectorInput as Add, ConnectorPatchInput as Patch, PreviewQuery as Preview, RefreshManifestInput as Refresh, RotateSecretInput as Rotate } from '@clew/contracts';
import { InputError, protectedRoute, type Env } from '../context';
import { connectorAdmin } from '../composition';

/**
 * Administration (D23): thin routes over `connectorAdmin`. The use cases check the grant capability and the step-up;
 * these parse, validate and map. No response here ever carries a secret.
 */
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = { add: ajv.compile(AddConnectorInput), patch: ajv.compile(ConnectorPatchInput), rotate: ajv.compile(RotateSecretInput), refresh: ajv.compile(RefreshManifestInput), preview: ajv.compile(PreviewQuery) };
async function body<T>(request: Request, validate: (value: unknown) => value is T): Promise<T> {
  const text = await request.text();
  if (text.length > 16000) throw new InputError('För stor förfrågan.');
  let value: unknown; try { value = text ? JSON.parse(text) : {}; } catch { throw new InputError('Ogiltig förfrågan.'); }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
export const adminRoutes = new Hono<Env>();
adminRoutes.use('*', protectedRoute());
adminRoutes.get('/units', async c => c.json({ units: await connectorAdmin.listUnits(c.get('session').context) }));
adminRoutes.get('/connectors', async c => c.json({ connectors: await connectorAdmin.list(c.get('session').context) }));
adminRoutes.post('/connectors', async c => c.json(await connectorAdmin.add(c.get('session').context, await body(c.req.raw, validators.add as unknown as (v: unknown) => v is Add)), 201));
adminRoutes.get('/connectors/:id', async c => c.json(await connectorAdmin.read(c.get('session').context, c.req.param('id'))));
adminRoutes.patch('/connectors/:id', async c => c.json(await connectorAdmin.update(c.get('session').context, c.req.param('id'), await body(c.req.raw, validators.patch as unknown as (v: unknown) => v is Patch))));
adminRoutes.delete('/connectors/:id', async c => c.json(await connectorAdmin.remove(c.get('session').context, c.req.param('id'))));
adminRoutes.post('/connectors/:id/secret', async c => c.json(await connectorAdmin.rotateSecret(c.get('session').context, c.req.param('id'), await body(c.req.raw, validators.rotate as unknown as (v: unknown) => v is Rotate))));
adminRoutes.post('/connectors/:id/test', async c => c.json(await connectorAdmin.test(c.get('session').context, c.req.param('id'))));
adminRoutes.post('/connectors/:id/refresh', async c => c.json(await connectorAdmin.refreshManifest(c.get('session').context, c.req.param('id'), await body(c.req.raw, validators.refresh as unknown as (v: unknown) => v is Refresh))));
adminRoutes.get('/connectors/:id/preview', async c => {
  const query = { role: c.req.query('role'), ...(c.req.query('unitId') ? { unitId: c.req.query('unitId') } : {}) };
  if (!validators.preview(query)) throw new InputError('Ogiltig förfrågan.');
  return c.json(await connectorAdmin.preview(c.get('session').context, c.req.param('id'), query as Preview));
});
