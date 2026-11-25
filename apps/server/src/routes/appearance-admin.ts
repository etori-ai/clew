import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import {
  AppearanceLogoInput,
  type AppearanceLogoInputType,
  AppearanceNameInput,
  type AppearanceNameInputType,
  AppearanceThemeInput,
  type AppearanceThemeInputType,
  type ThemeRefusal,
  THEME_FILE_MAX_BYTES,
} from '@clew/contracts';
import { InputError, failure, type Env } from '../context';
import { ThemeFileError, type AppearanceUsecases } from '../modules/appearance/usecases';
import { textOfAtMost } from '../bounded-body';

/**
 * Administration › Utseende (D98), mounted under `/api/admin/appearance` behind the administration's session guard,
 * which asks a change for the session's origin and CSRF token: the installation's name, theme file and logo, behind
 * `admin.appearance`. Thin: parse, validate, call one use case, which checks the capability and the step-up and writes
 * the audit row. A factory over the use cases, so the routes are tested without the composition
 * (`tests/unit/appearance-admin-routes.test.ts`).
 */
const ajv = new Ajv({ allErrors: false });
const validators = {
  name: ajv.compile(AppearanceNameInput),
  theme: ajv.compile(AppearanceThemeInput),
  logo: ajv.compile(AppearanceLogoInput),
};
async function body<T>(request: Request, validate: (value: unknown) => boolean, limit: number): Promise<T> {
  const text = await textOfAtMost(request, limit);
  if (text === undefined) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value as T;
}
export function appearanceAdminRoutes(
  appearance: Pick<
    AppearanceUsecases,
    'adminRead' | 'setName' | 'clearName' | 'setTheme' | 'clearTheme' | 'setLogo' | 'clearLogo'
  >,
  /** Who is signed in, for a test: the administration mounts these routes behind its own session guard. */
  guard?: MiddlewareHandler<Env>,
) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  // The same mapping the server gives every route, so a refusal reads the same wherever these are mounted.
  routes.onError((error, c) => failure(c, error));
  routes.get('/', async c => c.json(await appearance.adminRead(c.get('session').context)));
  routes.put('/name', async c =>
    c.json(
      await appearance.setName(
        c.get('session').context,
        // A name that can be saved is a body of a few hundred characters even with every character escaped: one far
        // longer is refused before it is parsed.
        (await body<AppearanceNameInputType>(c.req.raw, validators.name, 2000)).name,
      ),
    ),
  );
  routes.delete('/name', async c => c.json(await appearance.clearName(c.get('session').context)));
  routes.put('/theme', async c => {
    const input = await body<AppearanceThemeInputType>(c.req.raw, validators.theme, THEME_FILE_MAX_BYTES + 1000);
    try {
      return c.json(await appearance.setTheme(c.get('session').context, input.file));
    } catch (error) {
      // A refused file is answered with every problem it has, so the page can list them under the upload.
      if (error instanceof ThemeFileError)
        return c.json({ error: error.message, problems: error.problems } satisfies ThemeRefusal, 400);
      throw error;
    }
  });
  routes.delete('/theme', async c => c.json(await appearance.clearTheme(c.get('session').context)));
  // Two images of at most 256 kB each, in base64, and the name.
  routes.put('/logo', async c =>
    c.json(
      await appearance.setLogo(
        c.get('session').context,
        await body<AppearanceLogoInputType>(c.req.raw, validators.logo, 730_000),
      ),
    ),
  );
  routes.delete('/logo', async c => c.json(await appearance.clearLogo(c.get('session').context)));
  return routes;
}
