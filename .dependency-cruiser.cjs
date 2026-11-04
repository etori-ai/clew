/** Backend structure rules (D20), run by `bun run deps` as part of `bun run check`. See docs/architecture/backend-structure.md. */
const store = '^packages/db/|node_modules/(drizzle-orm|postgres)/';
const adapters = '^packages/calendar/src/(nextcloud|adapters)\\.ts$|/adapters?/';
const runtime = 'node_modules/(hono|jose|openid-client|@temporalio|@hono|ai|@ai-sdk)/';
module.exports = {
  forbidden: [
    { name: 'no-circular', comment: 'Temporal workflows and activities type each other (import type), which is its documented pattern and not a runtime cycle.',
      severity: 'error', from: { pathNot: '^apps/server/src/temporal/(workflows|activities)\\.ts$' }, to: { circular: true } },
    { name: 'routes-stay-thin', comment: 'A route parses, validates, calls one use case and maps errors. It never reads the database or an adapter.',
      severity: 'error', from: { path: '^apps/server/src/routes/' }, to: { path: store + '|' + adapters } },
    { name: 'domain-is-pure', comment: 'domain.ts and domain/ hold pure functions: no database, no network, no runtime libraries.',
      severity: 'error', from: { path: '(^|/)domain(\\.ts$|/)' }, to: { path: store + '|' + adapters + '|' + runtime } },
    { name: 'domain-no-core', comment: 'No Node built-ins in domain code either.', severity: 'error', from: { path: '(^|/)domain(\\.ts$|/)' }, to: { dependencyTypes: ['core'] } },
    { name: 'modules-do-not-import-each-other', comment: 'A module reaches another only through the registry (clew.call or /api/connectors/call), so any module can be shipped separately as a connector (D21).',
      severity: 'error', from: { path: '^apps/server/src/modules/([^/]+)/' }, to: { path: '^apps/server/src/modules/(?!$1/)[^/]+/' } },
    { name: 'mock-connectors-do-not-import-each-other', severity: 'error',
      from: { path: '^packages/connectors/src/mock/([^/]+)\\.ts$' }, to: { path: '^packages/connectors/src/mock/(?!$1\\.ts$|data\\.ts$)' } },
    { name: 'modules-do-not-import-the-platform', comment: 'A module knows its contract, the registry handle and its adapter, never routes, the stream or the assistant. The connector registry is platform code and is kept out of modules/ for that reason.',
      severity: 'error', from: { path: '^apps/server/src/modules/' }, to: { path: '^apps/server/src/(routes|threads|assistant|temporal|scheduler|main)' } },
    { name: 'packages-do-not-import-apps', severity: 'error', from: { path: '^packages/' }, to: { path: '^apps/' } },
    { name: 'contracts-is-a-leaf', severity: 'error', from: { path: '^packages/contracts/' }, to: { path: '^packages/(?!contracts/)' } },
    { name: 'connectors-package-has-no-database', comment: 'The capability layer and the protocol must run in a connector built outside this repository.',
      severity: 'error', from: { path: '^packages/connectors/' }, to: { path: '^packages/db/|node_modules/(drizzle-orm|postgres)/' } },
    { name: 'connectors-stand-alone', comment: 'A connector under connectors/ depends on nothing in this repository: it is built the way a third party builds one.',
      severity: 'error', from: { path: '^connectors/' }, to: { path: '^(apps|packages)/' } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'default', 'types'], mainFields: ['module', 'main', 'types'] },
  },
};
