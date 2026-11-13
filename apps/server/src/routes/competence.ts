import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  CompetenceDecisionBodySchema,
  CompetenceHoldingBodySchema,
  CompetenceImportBodySchema,
  CompetenceMappingBodySchema,
  CompetenceMergeBodySchema,
  CompetenceRequirementBodySchema,
  CompetenceSearchBodySchema,
  CompetenceSearchFileBodySchema,
  CompetenceShareTargetBodySchema,
  CompetenceSkillBodySchema,
  CompetenceSkillChangeBodySchema,
  CompetenceSkillRatingBodySchema,
  CompetenceTypeBodySchema,
  CompetenceTypePatchSchema,
  CompetenceTypeSearchBodySchema,
  CompetenceValidationBodySchema,
  type AuthenticatedContext,
  type CompetenceDecisionBody,
  type CompetenceHoldingBody,
  type CompetenceImportBody,
  type CompetenceMappingBody,
  type CompetenceMergeBody,
  type CompetenceMatrixInput,
  type CompetenceRequirementBody,
  type CompetenceSearchBody,
  type CompetenceSearchFileBody,
  type CompetenceShareTargetBody,
  type CompetenceSkillBody,
  type CompetenceSkillChangeBody,
  type CompetenceSkillRatingBody,
  type CompetenceTypeBody,
  type CompetenceTypePatch,
  type CompetenceTypeSearchBody,
  type CompetenceValidationBody,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { CompetenceUsecases } from '../modules/competence/usecases';

/**
 * The competence module's own routes (D108): the catalogue an administrator keeps, with its import from a file, a merge
 * of two types and a restore (D120 item 7, D108 item 2), the sources whose holdings are
 * copied in and their mappings to the catalogue (item 9), the requirements and share targets (item 6), a manager's
 * registration of a certificate, the manager's matrix and its file (item 11), which is no declared view because its
 * columns are chosen and a cell writes, a person's own registration with the decision of the manager they report to
 * (item 7), skills (D120): a person's own rating, its removal, and the manager's registration and confirmation of
 * a level, and Kompetenssökning (D121): who in the organisation holds a type, for a reader who holds the relation
 * `registrar`, with its file. A person's holdings, what needs attention and a unit's coverage have no route here:
 * Clew reads `competence.holdings`, `competence.attention` and `competence.coverage` through the capability route. Each
 * route parses, validates, calls one use case and maps its errors; the use cases own who may do what. Every route first
 * refuses unless the built-in module is switched on and visible to the person, so nothing of the domain is read or
 * written while an administrator has it off.
 */
export interface CompetenceRouteDeps {
  competence: Pick<
    CompetenceUsecases,
    | 'types'
    | 'addType'
    | 'updateType'
    | 'archiveType'
    | 'restoreType'
    | 'mergePreview'
    | 'mergeTypes'
    | 'importTypes'
    | 'validityImpact'
    | 'registerHolding'
    | 'revokeHolding'
    | 'sources'
    | 'mapSourceType'
    | 'readNow'
    | 'requirements'
    | 'addRequirement'
    | 'removeRequirement'
    | 'shareTargets'
    | 'addShareTarget'
    | 'removeShareTarget'
    | 'matrix'
    | 'exportMatrix'
    | 'ownRegistrations'
    | 'ownTypes'
    | 'registerOwn'
    | 'withdrawOwn'
    | 'removeRejected'
    | 'approval'
    | 'decideHolding'
    | 'rateOwnSkill'
    | 'changeOwnSkill'
    | 'removeOwnSkill'
    | 'registerSkill'
    | 'skillValidation'
    | 'validateSkill'
    | 'searchOptions'
    | 'findTypes'
    | 'search'
    | 'exportSearch'
  >;
  /** Whether the built-in module is on for this person now (composition: `competenceWritable`). */
  writable: (persona: AuthenticatedContext) => Promise<boolean>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
export const NOT_ENABLED = 'Kompetens är inte påslaget i den här installationen.';
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  type: ajv.compile<CompetenceTypeBody>(CompetenceTypeBodySchema),
  patch: ajv.compile<CompetenceTypePatch>(CompetenceTypePatchSchema),
  holding: ajv.compile<CompetenceHoldingBody>(CompetenceHoldingBodySchema),
  mapping: ajv.compile<CompetenceMappingBody>(CompetenceMappingBodySchema),
  requirement: ajv.compile<CompetenceRequirementBody>(CompetenceRequirementBodySchema),
  target: ajv.compile<CompetenceShareTargetBody>(CompetenceShareTargetBodySchema),
  decision: ajv.compile<CompetenceDecisionBody>(CompetenceDecisionBodySchema),
  rating: ajv.compile<CompetenceSkillRatingBody>(CompetenceSkillRatingBodySchema),
  change: ajv.compile<CompetenceSkillChangeBody>(CompetenceSkillChangeBodySchema),
  skill: ajv.compile<CompetenceSkillBody>(CompetenceSkillBodySchema),
  validation: ajv.compile<CompetenceValidationBody>(CompetenceValidationBodySchema),
  import: ajv.compile<CompetenceImportBody>(CompetenceImportBodySchema),
  merge: ajv.compile<CompetenceMergeBody>(CompetenceMergeBodySchema),
  search: ajv.compile<CompetenceSearchBody>(CompetenceSearchBodySchema),
  searchFile: ajv.compile<CompetenceSearchFileBody>(CompetenceSearchFileBodySchema),
  typeSearch: ajv.compile<CompetenceTypeSearchBody>(CompetenceTypeSearchBodySchema),
};
/**
 * The longest import request (D120 item 7): `COMPETENCE_IMPORT_REQUEST_MAX` rows of at most 240 + 160 + 300 characters
 * of name, area and address, with room for the rest of each row. The contract bounds every field again.
 */
const IMPORT_BODY_MAX = 1_000_000;
async function body<T>(request: Request, validate: (value: unknown) => value is T, max = 2000): Promise<T> {
  const text = await request.text();
  if (text.length > max) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** A path id as the contracts take one: 1 to 80 characters. */
function param(value: string | undefined) {
  if (!value || value.length > 80) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** A connector's id in the path, as the connector table holds one. */
function connector(value: string | undefined) {
  if (!value || value.length > 80 || !/^[a-z][a-z0-9-]*$/.test(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** The matrix's set of columns (D108 item 11): `?by=` (1 to 200 characters) and `?part=` (1 to 99), each optional. */
function matrixInput(by: string | undefined, part: string | undefined): CompetenceMatrixInput {
  const input: CompetenceMatrixInput = {};
  if (by !== undefined) {
    if (!by || by.length > 200) throw new InputError('Ogiltig förfrågan.');
    input.by = by;
  }
  if (part !== undefined) {
    if (!/^[1-9]\d?$/.test(part)) throw new InputError('Ogiltig förfrågan.');
    input.part = Number(part);
  }
  return input;
}
/** `?months=`: a whole number of months from 1 to 600, or `none` for no rule. */
function months(value: string | undefined): number | null {
  if (value === 'none') return null;
  const n = Number(value);
  if (!value || !/^\d{1,3}$/.test(value) || n < 1 || n > 600) throw new InputError('Ogiltig förfrågan.');
  return n;
}

export function competenceRoutes(deps: CompetenceRouteDeps) {
  const { competence } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  routes.use('*', async (c, next) => {
    if (!(await deps.writable(c.get('session').context)))
      return c.json({ error: NOT_ENABLED, code: 'denied' }, 403, privateHeaders);
    await next();
  });
  routes.get('/types', async c => c.json(await competence.types(c.get('session').context), 200, privateHeaders));
  routes.post('/types', async c => {
    const input = await body(c.req.raw, validators.type);
    return c.json({ id: await competence.addType(c.get('session').context, input) }, 201);
  });
  routes.get('/types/:id/validity', async c =>
    c.json(
      await competence.validityImpact(
        c.get('session').context,
        param(c.req.param('id')),
        months(c.req.query('months')),
      ),
      200,
      privateHeaders,
    ),
  );
  routes.patch('/types/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.patch);
    await competence.updateType(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.post('/types/:id/archive', async c => {
    await competence.archiveType(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // The catalogue at scale (D120 item 7, D108 item 2): an archived type brought back, two types merged, and the chosen
  // rows of an imported file, which the browser read with the parser the use case checks every row with again.
  routes.post('/types/:id/restore', async c => {
    await competence.restoreType(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.get('/types/:id/merge', async c =>
    c.json(
      await competence.mergePreview(c.get('session').context, param(c.req.param('id')), param(c.req.query('into'))),
      200,
      privateHeaders,
    ),
  );
  routes.post('/types/:id/merge', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.merge);
    return c.json(await competence.mergeTypes(c.get('session').context, id, input), 200);
  });
  routes.post('/types/import', async c => {
    const input = await body(c.req.raw, validators.import, IMPORT_BODY_MAX);
    return c.json(await competence.importTypes(c.get('session').context, input), 200);
  });
  routes.post('/people/:personId/holdings', async c => {
    const personId = param(c.req.param('personId')),
      input = await body(c.req.raw, validators.holding);
    return c.json({ id: await competence.registerHolding(c.get('session').context, personId, input) }, 201);
  });
  routes.delete('/holdings/:id', async c => {
    await competence.revokeHolding(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // A person's own registration (D108 item 7): whether anyone would decide it and what waits, a new one, and one taken
  // back while it waits.
  routes.get('/own', async c =>
    c.json(await competence.ownRegistrations(c.get('session').context), 200, privateHeaders),
  );
  routes.get('/own/types', async c => c.json(await competence.ownTypes(c.get('session').context), 200, privateHeaders));
  routes.post('/own/holdings', async c => {
    const input = await body(c.req.raw, validators.holding);
    return c.json({ id: await competence.registerOwn(c.get('session').context, input) }, 201);
  });
  routes.delete('/own/holdings/:id', async c => {
    await competence.withdrawOwn(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // One the manager rejected, removed by the person whose it is.
  routes.delete('/own/rejected/:id', async c => {
    await competence.removeRejected(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // A skill (D120): the person's own rating, stored at once, changed by its holding and removed by them.
  routes.post('/own/skills', async c => {
    const input = await body(c.req.raw, validators.rating);
    return c.json({ id: await competence.rateOwnSkill(c.get('session').context, input) }, 201);
  });
  routes.put('/own/skills/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.change);
    await competence.changeOwnSkill(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.delete('/own/skills/:id', async c => {
    await competence.removeOwnSkill(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // A manager the person reports to registers a skill for them, confirmed, or confirms the level of one they hold.
  routes.post('/people/:personId/skills', async c => {
    const personId = param(c.req.param('personId')),
      input = await body(c.req.raw, validators.skill);
    return c.json({ id: await competence.registerSkill(c.get('session').context, personId, input) }, 201);
  });
  routes.get('/skills/:id', async c =>
    c.json(await competence.skillValidation(c.get('session').context, param(c.req.param('id'))), 200, privateHeaders),
  );
  routes.post('/skills/:id/validation', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.validation);
    await competence.validateSkill(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  // Its decision by the manager the person reports to now: the registration as they read it, and approve or reject.
  routes.get('/approvals/:id', async c =>
    c.json(await competence.approval(c.get('session').context, param(c.req.param('id'))), 200, privateHeaders),
  );
  routes.post('/approvals/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.decision);
    await competence.decideHolding(c.get('session').context, id, input.decision);
    return c.body(null, 204);
  });
  // The sources whose holdings are copied in (D108 item 9): what each holds and its mappings, and a read started now.
  routes.get('/sources', async c => c.json(await competence.sources(c.get('session').context), 200, privateHeaders));
  routes.put('/sources/:connectorId/mapping', async c => {
    const connectorId = connector(c.req.param('connectorId')),
      input = await body(c.req.raw, validators.mapping);
    return c.json(await competence.mapSourceType(c.get('session').context, connectorId, input), 200);
  });
  routes.post('/sources/:connectorId/read', async c => {
    await competence.readNow(c.get('session').context, connector(c.req.param('connectorId')));
    return c.body(null, 202);
  });
  // What is required of whom (D108 item 6): on a position or a unit by an administrator, on one person by their manager.
  routes.get('/requirements', async c =>
    c.json(await competence.requirements(c.get('session').context), 200, privateHeaders),
  );
  routes.post('/requirements', async c => {
    const input = await body(c.req.raw, validators.requirement);
    return c.json({ id: await competence.addRequirement(c.get('session').context, input) }, 201);
  });
  routes.delete('/requirements/:id', async c => {
    await competence.removeRequirement(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // Share targets (D108 item 6): a least share of a position's holders, on a unit's branch or the whole organisation.
  routes.get('/share-targets', async c =>
    c.json(await competence.shareTargets(c.get('session').context), 200, privateHeaders),
  );
  routes.post('/share-targets', async c => {
    const input = await body(c.req.raw, validators.target);
    return c.json({ id: await competence.addShareTarget(c.get('session').context, input) }, 201);
  });
  routes.delete('/share-targets/:id', async c => {
    await competence.removeShareTarget(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // The manager's matrix (D108 item 11), and the same as a file: the download writes its audit row.
  routes.get('/matrix', async c =>
    c.json(
      await competence.matrix(c.get('session').context, matrixInput(c.req.query('by'), c.req.query('part'))),
      200,
      privateHeaders,
    ),
  );
  routes.get('/matrix.csv', async c => {
    const file = await competence.exportMatrix(
      c.get('session').context,
      matrixInput(c.req.query('by'), c.req.query('part')),
    );
    return c.body(file.text, 200, {
      ...privateHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
  });
  // Kompetenssökning (D121): who in the organisation holds a type, only for a reader who holds the relation `registrar`.
  // What is searched for is asked in a body (D100), never in an address, and every read is logged by the use case. The
  // type field asks the catalogue in a body too.
  routes.get('/search', async c =>
    c.json(await competence.searchOptions(c.get('session').context), 200, privateHeaders),
  );
  routes.post('/search', async c =>
    c.json(
      await competence.search(c.get('session').context, await body(c.req.raw, validators.search)),
      200,
      privateHeaders,
    ),
  );
  routes.post('/search/types', async c =>
    c.json(
      await competence.findTypes(c.get('session').context, await body(c.req.raw, validators.typeSearch)),
      200,
      privateHeaders,
    ),
  );
  routes.post('/search.csv', async c => {
    const file = await competence.exportSearch(c.get('session').context, await body(c.req.raw, validators.searchFile));
    return c.body(file.text, 200, {
      ...privateHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
