import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  AppearanceLogoInput,
  type AppearanceLogoInputType,
  AppearanceThemeInput,
  type AppearanceThemeInputType,
  type ThemeRefusal,
  THEME_FILE_MAX_BYTES,
  GroupCapabilityInput,
  type GroupCapabilityInputType,
  AddConnectorInput,
  AddModelInput,
  AddProviderInput,
  ConnectorPatchInput,
  ModelPatchInput,
  PreviewQuery,
  ProviderKeyInput,
  ProviderPatchInput,
  RefreshManifestInput,
  RotateSecretInput,
} from '@clew/contracts';
import type {
  AddConnectorInput as Add,
  ConnectorPatchInput as Patch,
  PreviewQuery as Preview,
  RefreshManifestInput as Refresh,
  RotateSecretInput as Rotate,
} from '@clew/contracts';
import { InputError, protectedRoute, type Env } from '../context';
import { connectorAdmin, models } from '../composition';
import { usersAdmin } from '../composition/people';
import { operations } from '../composition/operations';
import { appearance } from '../composition/appearance';
import { ThemeFileError } from '../modules/appearance/usecases';

/**
 * Administration (D23, D24): thin routes over `connectorAdmin` and `models`. The use cases check the grant capability
 * and the step-up; these parse, validate and map. No response here ever carries a secret or a key.
 */
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  add: ajv.compile(AddConnectorInput),
  patch: ajv.compile(ConnectorPatchInput),
  rotate: ajv.compile(RotateSecretInput),
  refresh: ajv.compile(RefreshManifestInput),
  preview: ajv.compile(PreviewQuery),
  addProvider: ajv.compile(AddProviderInput),
  patchProvider: ajv.compile(ProviderPatchInput),
  providerKey: ajv.compile(ProviderKeyInput),
  addModel: ajv.compile(AddModelInput),
  patchModel: ajv.compile(ModelPatchInput),
  groupCapability: ajv.compile(GroupCapabilityInput),
  appearanceTheme: ajv.compile(AppearanceThemeInput),
  appearanceLogo: ajv.compile(AppearanceLogoInput),
};
async function body<T>(request: Request, validate: (value: unknown) => boolean, limit = 16000): Promise<T> {
  const text = await request.text();
  if (text.length > limit) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value as T;
}
export const adminRoutes = new Hono<Env>();
adminRoutes.use('*', protectedRoute());
adminRoutes.get('/reliability', async c => c.json(await operations.reliability(c.get('session').context)));
adminRoutes.get('/units', async c => c.json({ units: await connectorAdmin.listUnits(c.get('session').context) }));
adminRoutes.get('/groups', async c => c.json({ groups: await connectorAdmin.listGroups(c.get('session').context) }));
// Användare (D62, D85): the provisioned people and the group-capability rows, behind `admin.users`.
adminRoutes.get('/users', async c => c.json(await usersAdmin.overview(c.get('session').context)));
adminRoutes.post('/users/group-capabilities', async c =>
  c.json(
    await usersAdmin.addGroupCapability(
      c.get('session').context,
      await body<GroupCapabilityInputType>(c.req.raw, validators.groupCapability),
    ),
  ),
);
adminRoutes.post('/users/group-capabilities/remove', async c =>
  c.json(
    await usersAdmin.removeGroupCapability(
      c.get('session').context,
      await body<GroupCapabilityInputType>(c.req.raw, validators.groupCapability),
    ),
  ),
);
// Utseende (D97): the installation's theme file and logo, behind `admin.appearance`.
adminRoutes.get('/appearance', async c => c.json(await appearance.adminRead(c.get('session').context)));
adminRoutes.put('/appearance/theme', async c => {
  const input = await body<AppearanceThemeInputType>(
    c.req.raw,
    validators.appearanceTheme,
    THEME_FILE_MAX_BYTES + 1000,
  );
  try {
    return c.json(await appearance.setTheme(c.get('session').context, input.file));
  } catch (error) {
    // A refused file is answered with every problem it has, so the page can list them under the upload.
    if (error instanceof ThemeFileError)
      return c.json({ error: error.message, problems: error.problems } satisfies ThemeRefusal, 400);
    throw error;
  }
});
adminRoutes.delete('/appearance/theme', async c => c.json(await appearance.clearTheme(c.get('session').context)));
// Two images of at most 256 kB each, in base64, and the name.
adminRoutes.put('/appearance/logo', async c =>
  c.json(
    await appearance.setLogo(
      c.get('session').context,
      await body<AppearanceLogoInputType>(c.req.raw, validators.appearanceLogo, 730_000),
    ),
  ),
);
adminRoutes.delete('/appearance/logo', async c => c.json(await appearance.clearLogo(c.get('session').context)));
adminRoutes.get('/connectors', async c => c.json({ connectors: await connectorAdmin.list(c.get('session').context) }));
adminRoutes.post('/connectors', async c =>
  c.json(await connectorAdmin.add(c.get('session').context, await body<Add>(c.req.raw, validators.add)), 201),
);
adminRoutes.get('/connectors/:id', async c =>
  c.json(await connectorAdmin.read(c.get('session').context, c.req.param('id'))),
);
adminRoutes.patch('/connectors/:id', async c =>
  c.json(
    await connectorAdmin.update(
      c.get('session').context,
      c.req.param('id'),
      await body<Patch>(c.req.raw, validators.patch),
    ),
  ),
);
adminRoutes.delete('/connectors/:id', async c =>
  c.json(await connectorAdmin.remove(c.get('session').context, c.req.param('id'))),
);
adminRoutes.post('/connectors/:id/secret', async c =>
  c.json(
    await connectorAdmin.rotateSecret(
      c.get('session').context,
      c.req.param('id'),
      await body<Rotate>(c.req.raw, validators.rotate),
    ),
  ),
);
adminRoutes.post('/connectors/:id/test', async c =>
  c.json(await connectorAdmin.test(c.get('session').context, c.req.param('id'))),
);
adminRoutes.post('/connectors/:id/refresh', async c =>
  c.json(
    await connectorAdmin.refreshManifest(
      c.get('session').context,
      c.req.param('id'),
      await body<Refresh>(c.req.raw, validators.refresh),
    ),
  ),
);
adminRoutes.get('/connectors/:id/preview', async c => {
  const query = { role: c.req.query('role'), ...(c.req.query('unitId') ? { unitId: c.req.query('unitId') } : {}) };
  if (!validators.preview(query)) throw new InputError('Ogiltig förfrågan.');
  return c.json(await connectorAdmin.preview(c.get('session').context, c.req.param('id'), query as Preview));
});
// Modeller (D24): providers and the models under them.
adminRoutes.get('/models', async c => c.json(await models.list(c.get('session').context)));
adminRoutes.post('/models', async c =>
  c.json(
    await models.addModel(c.get('session').context, await body<AddModelInput>(c.req.raw, validators.addModel)),
    201,
  ),
);
adminRoutes.get('/models/:id', async c => c.json(await models.readModel(c.get('session').context, c.req.param('id'))));
adminRoutes.patch('/models/:id', async c =>
  c.json(
    await models.updateModel(
      c.get('session').context,
      c.req.param('id'),
      await body<ModelPatchInput>(c.req.raw, validators.patchModel),
    ),
  ),
);
adminRoutes.delete('/models/:id', async c =>
  c.json(await models.removeModel(c.get('session').context, c.req.param('id'))),
);
adminRoutes.post('/models/:id/test', async c =>
  c.json(await models.testModel(c.get('session').context, c.req.param('id'))),
);
adminRoutes.post('/providers', async c =>
  c.json(
    await models.addProvider(c.get('session').context, await body<AddProviderInput>(c.req.raw, validators.addProvider)),
    201,
  ),
);
adminRoutes.get('/providers/:id', async c =>
  c.json(await models.readProvider(c.get('session').context, c.req.param('id'))),
);
adminRoutes.patch('/providers/:id', async c =>
  c.json(
    await models.updateProvider(
      c.get('session').context,
      c.req.param('id'),
      await body<ProviderPatchInput>(c.req.raw, validators.patchProvider),
    ),
  ),
);
adminRoutes.delete('/providers/:id', async c =>
  c.json(await models.removeProvider(c.get('session').context, c.req.param('id'))),
);
adminRoutes.post('/providers/:id/key', async c =>
  c.json(
    await models.rotateKey(
      c.get('session').context,
      c.req.param('id'),
      await body<ProviderKeyInput>(c.req.raw, validators.providerKey),
    ),
  ),
);
adminRoutes.post('/providers/:id/test', async c =>
  c.json(await models.testProvider(c.get('session').context, c.req.param('id'))),
);
