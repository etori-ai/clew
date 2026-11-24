import { Type } from 'typebox';
import type { Actor, Capability, Connector } from '@clew/connectors';
import type { AuthenticatedContext, View } from '@clew/contracts';
import { systemContext } from '../../system-context';
import type { ReportUsecases } from './usecases';

/**
 * The reader's people as a read for the assistant (D141 rule 4): `people.reports` is Personal's list, the people
 * `GET /api/entities/person` draws for a manager (`groupsOf`), so the assistant asked beside Personal reads the list
 * the page shows. It joins the `people` connector of D62 in the registry, which names connectors; the rule of who is on
 * the list stays the entities module's. Each person is their name, user name, title and the units that list them:
 * nothing from a source and no HR data. Offered to the model, read as the person and nobody more; nothing is logged,
 * as the list is logged nowhere when a person reads it (D122 item 6).
 */
export const REPORTS_CAPABILITY = 'people.reports';
const REPORTS_MAX = 500;
const ReportsInputSchema = Type.Object({}, { additionalProperties: false });
export const ReportsOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          name: Type.String({ maxLength: 512 }),
          userName: Type.String({ minLength: 1, maxLength: 256 }),
          title: Type.Optional(Type.String({ maxLength: 512 })),
          unit: Type.String({ maxLength: 2000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: REPORTS_MAX },
    ),
    /** How many people the list has beyond the rows given. */
    omitted: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
/** The people as a list: the name first, the title and the unit under it. A row names its person by user name. */
export const reportsView: View = {
  kind: 'list',
  title: 'name',
  noun: { one: 'medarbetare', other: 'medarbetare' },
  empty: 'Det finns ingen på enheterna du är chef för.',
  fields: [
    { key: 'name', label: 'Namn' },
    { key: 'title', label: 'Titel' },
    { key: 'unit', label: 'Enhet' },
  ],
  subject: { entity: 'person', key: 'userName' },
};

/** The persona a use case takes, built from the person's current grant as the built-in connectors do. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:people');
  if (!persona) throw new Error('Okänd person.');
  return persona;
}

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function reportCapabilities(
  reports: ReportUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Pick<Connector, 'capabilities'> {
  const list: Capability<Record<string, never>> = {
    name: REPORTS_CAPABILITY,
    kind: 'read',
    title: 'Mina medarbetare',
    model: true,
    description:
      'Medarbetarna på enheterna du är chef för, så som Personal listar dem: namn, användarnamn, titel när Clew har en, och enheten. Också den som är chef för enheten tillsammans med dig och chefer på enheter under dina som rapporterar till dig. Tar ingen indata. Inga uppgifter ur personalsystemet. Användarnamnet tar andra verktyg som person.',
    input: ReportsInputSchema,
    output: ReportsOutputSchema,
    view: reportsView,
    scope: { roles: ['manager'] },
    run: async actor => {
      const rows = await reports.reports(await persona(actor));
      return {
        rows: rows.slice(0, REPORTS_MAX),
        ...(rows.length > REPORTS_MAX ? { omitted: rows.length - REPORTS_MAX } : {}),
      };
    },
  };
  return { capabilities: [list as Capability] };
}
