import {
  THEME_BASE_COLORS,
  parseThemeFile,
  themeFileOf,
  type AppearanceAdminView,
  type AppearanceLogoInputType,
  type AuthenticatedContext,
  type Capability,
  type InstallationAppearance,
  type ThemeProblem,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import { isLogoProblem, logoImageOf } from './domain';
import type { AppearanceRecord, AppearanceStore, LogoImage } from './ports';

/**
 * The installation's appearance (D97): the theme every page is drawn in and the logo in the header, chosen by an
 * administrator in the product and stored in Clew's own database, not in the build.
 *
 * `read` and `logo` are what any browser asks before a person has signed in, so they take no actor and answer nothing
 * but the appearance. Every change needs the grant capability `admin.appearance` and the step-up `authorize()`, and
 * writes its audit row in the same transaction (`appearance.theme.set`, `appearance.theme.cleared`,
 * `appearance.logo.set`, `appearance.logo.cleared`). An audit row names the theme and the image's type and size, never
 * the colours' file or the image.
 */
export const APPEARANCE_CAPABILITY: Capability = 'admin.appearance';
export const APPEARANCE_SUBJECT = 'installation:appearance';
/** A refused theme file: the route answers 400 with every problem, for the page to list under the upload. */
export class ThemeFileError extends InputError {
  constructor(readonly problems: ThemeProblem[]) {
    super('Temafilen kan inte användas.');
    this.name = 'ThemeFileError';
  }
}
export type LogoVariant = 'light' | 'dark';
/** Who a change is recorded as: the audit row's actor, and the name the administration page shows beside the time. */
interface Author {
  actor: string;
  name: string;
}
const OPERATOR: Author = { actor: 'bootstrap:appearance', name: 'Kommandoraden' };
const logoPath = (variant: LogoVariant, revision: number) => `/api/appearance/logo/${variant}?v=${revision}`;

export function appearanceUsecases(deps: { store: AppearanceStore; clock: () => Date }) {
  const require = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(APPEARANCE_CAPABILITY)) throw new ForbiddenError();
  };
  const publicView = (record: AppearanceRecord): InstallationAppearance => ({
    revision: record.revision,
    theme: record.theme,
    logo: record.logo
      ? {
          src: logoPath('light', record.revision),
          ...(record.logo.dark ? { darkSrc: logoPath('dark', record.revision) } : {}),
          alt: record.logo.alt,
        }
      : null,
  });
  const adminView = (record: AppearanceRecord): AppearanceAdminView => ({
    ...publicView(record),
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  });
  /** One audited change: the next record from the stored one, or null when nothing would change and nothing is written. */
  async function change(
    author: Author,
    action: string,
    next: (
      current: AppearanceRecord,
    ) => { record: Pick<AppearanceRecord, 'theme' | 'logo'>; details: Record<string, unknown> } | null,
  ): Promise<AppearanceAdminView> {
    return deps.store.transaction(async tx => {
      const current = await tx.read();
      const changed = next(current);
      if (!changed) return adminView(current);
      const record: AppearanceRecord = {
        ...changed.record,
        revision: current.revision + 1,
        updatedAt: deps.clock().toISOString(),
        updatedBy: author.name,
      };
      await tx.write(record);
      await tx.audit({
        actor: author.actor,
        action,
        subject: APPEARANCE_SUBJECT,
        details: { ...changed.details, revision: record.revision },
      });
      return adminView(record);
    });
  }
  const describe = (image: LogoImage) => ({ mediaType: image.mediaType, bytes: image.bytes.length });
  /**
   * The four changes for one author. `allowed` refuses before anything is read; `author` is asked only once the input
   * holds, so a person's step-up is not spent on a file that is refused.
   */
  function changes(allowed: () => void, author: () => Promise<Author>) {
    return {
      /** Replaces the theme with an uploaded file's, refused whole with every problem named when it does not hold. */
      async setTheme(file: unknown): Promise<AppearanceAdminView> {
        allowed();
        const parsed = parseThemeFile(file);
        if (!parsed.ok) throw new ThemeFileError(parsed.problems);
        return change(await author(), 'appearance.theme.set', current => ({
          record: { theme: parsed.theme, logo: current.logo },
          details: { name: parsed.theme.name, tokens: Object.keys(parsed.theme.colors).length },
        }));
      },
      /** Back to Astryx Neutral. */
      async clearTheme(): Promise<AppearanceAdminView> {
        allowed();
        return change(await author(), 'appearance.theme.cleared', current =>
          current.theme ? { record: { theme: null, logo: current.logo }, details: { name: current.theme.name } } : null,
        );
      },
      async setLogo(input: AppearanceLogoInputType): Promise<AppearanceAdminView> {
        allowed();
        const light = input.light ? logoImageOf(input.light, 'Logotypen') : undefined;
        if (light && isLogoProblem(light)) throw new InputError(light.problem);
        const dark = input.dark ? logoImageOf(input.dark, 'Logotypen för mörkt läge') : input.dark;
        if (dark && isLogoProblem(dark)) throw new InputError(dark.problem);
        return change(await author(), 'appearance.logo.set', current => {
          const image = light ?? current.logo?.light;
          if (!image) throw new InputError('Välj en bild för logotypen.');
          const night = dark === undefined ? (current.logo?.dark ?? null) : dark;
          return {
            record: { theme: current.theme, logo: { alt: input.alt.trim(), light: image, dark: night } },
            details: { alt: input.alt.trim(), light: describe(image), dark: night ? describe(night) : null },
          };
        });
      },
      async clearLogo(): Promise<AppearanceAdminView> {
        allowed();
        return change(await author(), 'appearance.logo.cleared', current =>
          current.logo ? { record: { theme: current.theme, logo: null }, details: { alt: current.logo.alt } } : null,
        );
      },
    };
  }
  const by = (persona: AuthenticatedContext) =>
    changes(
      () => require(persona),
      async () => {
        await persona.authorize();
        return { actor: 'person:' + persona.id, name: persona.name };
      },
    );
  return {
    /** Public: what every page is drawn with, the sign-in page included. */
    async read(): Promise<InstallationAppearance> {
      return publicView(await deps.store.read());
    },
    /** Public: one image of the logo, or null when the installation has none. */
    async logo(variant: LogoVariant): Promise<(LogoImage & { revision: number }) | null> {
      const record = await deps.store.read();
      const image = variant === 'dark' ? record.logo?.dark : record.logo?.light;
      return image ? { ...image, revision: record.revision } : null;
    },
    /**
     * Public: the saved theme as a file again, or with none saved a template of Clew's own base colours for the roles
     * a contrast pair names, which is a valid theme file and the place to start writing one.
     */
    async themeFile(): Promise<Record<string, unknown>> {
      const { theme } = await deps.store.read();
      return themeFileOf(theme ?? { name: 'Mall: Clews standardfärger', colors: THEME_BASE_COLORS });
    },
    async adminRead(persona: AuthenticatedContext): Promise<AppearanceAdminView> {
      require(persona);
      return adminView(await deps.store.read());
    },
    setTheme: (persona: AuthenticatedContext, file: unknown) => by(persona).setTheme(file),
    clearTheme: (persona: AuthenticatedContext) => by(persona).clearTheme(),
    setLogo: (persona: AuthenticatedContext, input: AppearanceLogoInputType) => by(persona).setLogo(input),
    clearLogo: (persona: AuthenticatedContext) => by(persona).clearLogo(),
    /**
     * The same four changes for the operator at the command line (`scripts/appearance-set.ts`), who has the database
     * and no session: the same checks of the file and the image, the same audit rows, with `bootstrap:appearance` as
     * the actor, as `bootstrap:connector` is for a connector registered from there (D23). No route reaches this.
     */
    operator: changes(
      () => undefined,
      async () => OPERATOR,
    ),
  };
}
export type AppearanceUsecases = ReturnType<typeof appearanceUsecases>;
